import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import type {
  Attribute,
  AttributeOption,
  CategoryAttribute,
  SellingUnit,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { MinioService } from '../../infrastructure/storage/minio.service';
import { AuditService } from '../audit/audit.service';
import { AttributesService } from '../attributes/attributes.service';
import { assertValidAttributeValue } from '../attributes/attribute-value.validator';
import { computeCombinationKey } from '../products/attribute-values.helper';
import { slugify } from '../../common/utils/slugify';

const SELLING_UNITS = [
  'PIECE',
  'METER',
  'ROLL',
  'KILOGRAM',
  'PACKAGE',
  'PARCEL',
  'SHEET',
];

type CategoryAttributeWithAttribute = CategoryAttribute & {
  attribute: Attribute & { options: AttributeOption[] };
};

interface NormalizedRow {
  sku: string;
  productName: string;
  categorySlug: string;
  brandSlug?: string;
  priceRaw: string;
  sellingUnit?: string;
  weightRaw?: string;
  attributes: Record<string, string>;
}

function normalizeRow(raw: Record<string, string>): NormalizedRow {
  const attributes: Record<string, string> = {};
  for (const [column, value] of Object.entries(raw)) {
    if (column.toLowerCase().startsWith('attr_') && value?.trim()) {
      attributes[column.slice(5).toLowerCase().trim()] = value.trim();
    }
  }

  return {
    sku: raw.sku?.trim() ?? '',
    productName: raw.productName?.trim() ?? '',
    categorySlug: slugify(raw.categorySlug?.trim() ?? ''),
    brandSlug: raw.brandSlug?.trim()
      ? slugify(raw.brandSlug.trim())
      : undefined,
    priceRaw: raw.price?.trim() ?? '',
    sellingUnit: raw.sellingUnit?.trim().toUpperCase() || undefined,
    weightRaw: raw.weight?.trim() || undefined,
    attributes,
  };
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minioService: MinioService,
    private readonly auditService: AuditService,
    private readonly attributesService: AttributesService,
  ) {}

  async upload(file: Express.Multer.File, actorId: string) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      throw new BadRequestException('only .csv files are supported');
    }

    let records: Record<string, string>[];
    try {
      records = parse(file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (error) {
      throw new BadRequestException(
        `could not parse CSV: ${(error as Error).message}`,
      );
    }
    if (records.length === 0) {
      throw new BadRequestException('the file has no data rows');
    }

    const sourceFileKey = `imports/${randomUUID()}/${file.originalname}`;
    // Best-effort archival of the source file for audit; a failure here must not block staging the import.
    await this.minioService
      .putObject(sourceFileKey, file.buffer, 'text/csv')
      .catch(() => undefined);

    const rows = await this.validateRows(records);

    const batch = await this.prisma.importBatch.create({
      data: {
        sourceFilename: file.originalname,
        sourceFileKey,
        uploadedById: actorId,
        status: 'PREVIEWED',
        totalRows: rows.length,
        validRows: rows.filter((row) => row.status === 'VALID').length,
        errorRows: rows.filter((row) => row.status === 'ERROR').length,
        rows: {
          create: rows.map((row) => ({
            rowNumber: row.rowNumber,
            rawData: row.rawData,
            status: row.status,
            errors: row.errors.length > 0 ? row.errors : undefined,
          })),
        },
      },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });

    await this.auditService.log({
      actorId,
      action: 'import.upload',
      entityType: 'import_batch',
      entityId: batch.id,
      after: {
        totalRows: batch.totalRows,
        validRows: batch.validRows,
        errorRows: batch.errorRows,
      },
    });

    return batch;
  }

  private async validateRows(records: Record<string, string>[]) {
    const normalized = records.map((raw, index) => ({
      rowNumber: index + 2,
      raw,
      data: normalizeRow(raw),
    }));

    const categorySlugs = [
      ...new Set(
        normalized.map((row) => row.data.categorySlug).filter(Boolean),
      ),
    ];
    const brandSlugs = [
      ...new Set(
        normalized
          .map((row) => row.data.brandSlug)
          .filter((slug): slug is string => !!slug),
      ),
    ];

    const [categories, brands, existingVariants] = await Promise.all([
      this.prisma.category.findMany({ where: { slug: { in: categorySlugs } } }),
      this.prisma.brand.findMany({ where: { slug: { in: brandSlugs } } }),
      this.prisma.productVariant.findMany({
        where: {
          sku: { in: normalized.map((row) => row.data.sku).filter(Boolean) },
        },
        select: { sku: true },
      }),
    ]);
    const categoryBySlug = new Map(
      categories.map((category) => [category.slug, category]),
    );
    const brandBySlug = new Map(brands.map((brand) => [brand.slug, brand]));
    const existingSkus = new Set(
      existingVariants.map((variant) => variant.sku),
    );

    const categoryRulesCache = new Map<
      string,
      {
        variantAttributes: CategoryAttributeWithAttribute[];
        infoAttributes: CategoryAttributeWithAttribute[];
      }
    >();
    for (const categoryId of new Set(
      categories.map((category) => category.id),
    )) {
      categoryRulesCache.set(
        categoryId,
        await this.attributesService.getCategoryAttributeRules(categoryId),
      );
    }

    const groups = new Map<string, typeof normalized>();
    for (const row of normalized) {
      const groupKey = `${row.data.categorySlug}::${row.data.productName.toLowerCase()}`;
      const group = groups.get(groupKey) ?? [];
      group.push(row);
      groups.set(groupKey, group);
    }

    const seenSkusInFile = new Set<string>();
    const results: {
      rowNumber: number;
      rawData: Record<string, string>;
      status: 'VALID' | 'ERROR';
      errors: string[];
    }[] = [];

    for (const groupRows of groups.values()) {
      const combinationKeysInGroup = new Set<string>();
      const category = categoryBySlug.get(groupRows[0].data.categorySlug);
      const rules = category ? categoryRulesCache.get(category.id) : undefined;

      for (const row of groupRows) {
        const errors: string[] = [];
        const { data } = row;

        if (!data.sku) errors.push('sku is required');
        if (!data.productName) errors.push('productName is required');
        if (!data.categorySlug) errors.push('categorySlug is required');
        if (!category) errors.push(`category "${data.categorySlug}" not found`);
        if (data.brandSlug && !brandBySlug.has(data.brandSlug)) {
          errors.push(`brand "${data.brandSlug}" not found`);
        }

        const price = Number(data.priceRaw);
        if (!data.priceRaw || Number.isNaN(price) || price <= 0) {
          errors.push('price must be a positive number');
        }

        if (data.sellingUnit && !SELLING_UNITS.includes(data.sellingUnit)) {
          errors.push(
            `sellingUnit must be one of: ${SELLING_UNITS.join(', ')}`,
          );
        }
        if (
          data.weightRaw !== undefined &&
          Number.isNaN(Number(data.weightRaw))
        ) {
          errors.push('weight must be numeric');
        }

        if (data.sku) {
          if (existingSkus.has(data.sku))
            errors.push(`sku "${data.sku}" already exists in the catalog`);
          if (seenSkusInFile.has(data.sku))
            errors.push(`sku "${data.sku}" is duplicated in this file`);
          seenSkusInFile.add(data.sku);
        }

        let combinationKey = '';
        if (rules) {
          for (const rule of rules.variantAttributes) {
            const value = data.attributes[rule.attribute.key];
            if (!value) {
              errors.push(
                `missing value for required variant attribute "${rule.attribute.key}"`,
              );
              continue;
            }
            try {
              assertValidAttributeValue(rule.attribute, value);
            } catch (error) {
              errors.push((error as Error).message);
            }
          }
          for (const rule of rules.infoAttributes) {
            const value = data.attributes[rule.attribute.key];
            if (rule.isRequired && !value) {
              errors.push(
                `missing value for required attribute "${rule.attribute.key}"`,
              );
            } else if (value) {
              try {
                assertValidAttributeValue(rule.attribute, value);
              } catch (error) {
                errors.push((error as Error).message);
              }
            }
          }

          if (rules.variantAttributes.length > 0) {
            combinationKey = computeCombinationKey(
              rules.variantAttributes
                .filter((rule) => data.attributes[rule.attribute.key])
                .map((rule) => ({
                  attributeId: rule.attributeId,
                  value: data.attributes[rule.attribute.key],
                })),
            );
            if (combinationKeysInGroup.has(combinationKey)) {
              errors.push(
                'this attribute combination is duplicated within the same product in this file',
              );
            }
            combinationKeysInGroup.add(combinationKey);
          } else if (groupRows.length > 1) {
            errors.push(
              'this category has no variant-defining attributes, so a product can only have one row (one simple SKU)',
            );
          }
        }

        results.push({
          rowNumber: row.rowNumber,
          rawData: row.raw,
          status: errors.length > 0 ? 'ERROR' : 'VALID',
          errors,
        });
      }
    }

    return results.sort((a, b) => a.rowNumber - b.rowNumber);
  }

  async findOne(id: string) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
    if (!batch) {
      throw new NotFoundException('import batch not found');
    }
    return batch;
  }

  findAll() {
    return this.prisma.importBatch.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async commit(id: string, actorId: string) {
    const batch = await this.findOne(id);
    if (batch.status !== 'PREVIEWED') {
      throw new ConflictException(
        `batch is "${batch.status}" and cannot be committed`,
      );
    }

    const validRows = batch.rows.filter((row) => row.status === 'VALID');
    if (validRows.length === 0) {
      throw new BadRequestException('there are no valid rows to commit');
    }

    const retailList = await this.prisma.priceList.findUniqueOrThrow({
      where: { key: 'retail' },
    });

    const groups = new Map<string, typeof validRows>();
    for (const row of validRows) {
      const data = normalizeRow(row.rawData as Record<string, string>);
      const groupKey = `${data.categorySlug}::${data.productName.toLowerCase()}`;
      const group = groups.get(groupKey) ?? [];
      group.push(row);
      groups.set(groupKey, group);
    }

    const rowResolutions = new Map<
      string,
      { productId: string; variantId: string }
    >();

    await this.prisma.$transaction(async (tx) => {
      for (const groupRows of groups.values()) {
        const firstData = normalizeRow(
          groupRows[0].rawData as Record<string, string>,
        );
        const category = await tx.category.findUniqueOrThrow({
          where: { slug: firstData.categorySlug },
        });
        const rules = await this.attributesService.getCategoryAttributeRules(
          category.id,
        );
        const brand = firstData.brandSlug
          ? await tx.brand.findUnique({ where: { slug: firstData.brandSlug } })
          : null;

        const existingProduct = await tx.product.findFirst({
          where: { categoryId: category.id, name: firstData.productName },
        });

        const infoValues = rules.infoAttributes
          .filter((rule) => firstData.attributes[rule.attribute.key])
          .map((rule) => ({
            attributeId: rule.attributeId,
            value: firstData.attributes[rule.attribute.key],
          }));

        const product =
          existingProduct ??
          (await tx.product.create({
            data: {
              categoryId: category.id,
              brandId: brand?.id,
              name: firstData.productName,
              slug: slugify(firstData.productName),
              type: rules.variantAttributes.length > 0 ? 'VARIABLE' : 'SIMPLE',
              sellingUnit: (firstData.sellingUnit ?? 'PIECE') as SellingUnit,
              status: 'DRAFT',
              attributeValues: { create: infoValues },
            },
          }));

        for (const row of groupRows) {
          const data = normalizeRow(row.rawData as Record<string, string>);
          const variantAttrs = rules.variantAttributes
            .filter((rule) => data.attributes[rule.attribute.key])
            .map((rule) => ({
              attributeId: rule.attributeId,
              value: data.attributes[rule.attribute.key],
            }));

          const variant = await tx.productVariant.create({
            data: {
              productId: product.id,
              sku: data.sku,
              weight: data.weightRaw ? Number(data.weightRaw) : undefined,
              combinationKey:
                variantAttrs.length > 0
                  ? computeCombinationKey(variantAttrs)
                  : '',
              attributeValues: { create: variantAttrs },
            },
          });

          await tx.price.create({
            data: {
              variantId: variant.id,
              priceListId: retailList.id,
              amount: Number(data.priceRaw),
            },
          });

          rowResolutions.set(row.id, {
            productId: product.id,
            variantId: variant.id,
          });
        }
      }

      for (const row of batch.rows) {
        const resolution = rowResolutions.get(row.id);
        await tx.importRow.update({
          where: { id: row.id },
          data: resolution
            ? {
                status: 'COMMITTED',
                resolvedProductId: resolution.productId,
                resolvedVariantId: resolution.variantId,
              }
            : { status: 'SKIPPED' },
        });
      }

      await tx.importBatch.update({
        where: { id },
        data: { status: 'COMMITTED', committedAt: new Date() },
      });
    });

    await this.auditService.log({
      actorId,
      action: 'import.commit',
      entityType: 'import_batch',
      entityId: id,
      after: { committedRows: rowResolutions.size },
    });

    return this.findOne(id);
  }
}
