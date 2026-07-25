import { registerDecorator, ValidationOptions } from 'class-validator';

const COMMON_PASSWORDS = new Set([
  'password',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyuiop',
  'letmein123',
  'welcome123',
  'admin1234',
  'iloveyou1',
  '11111111',
  '00000000',
  'abc123456',
  'changeme',
  'changeme123',
  'password1',
]);

export function IsNotCommonPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotCommonPassword',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return (
            typeof value === 'string' &&
            !COMMON_PASSWORDS.has(value.toLowerCase())
          );
        },
        defaultMessage() {
          return 'password is too common, choose a stronger password';
        },
      },
    });
  };
}
