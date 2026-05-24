import { Transform } from 'class-transformer';
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import {
  DomainValidationError,
  normalizeDomains,
  NormalizeDomainOptions,
} from '../../utils/domain-utils';

function normalizeOrThrow(
  value: unknown,
  options: NormalizeDomainOptions,
): void {
  if (!Array.isArray(value)) {
    throw new DomainValidationError('Domains must be provided as an array');
  }

  normalizeDomains(value, options);
}

export function NormalizeDomainList(
  options: NormalizeDomainOptions = {},
): PropertyDecorator {
  return Transform(({ value }) => {
    if (!Array.isArray(value)) {
      return value;
    }

    return normalizeDomains(value, options);
  });
}

export function IsDomainList(
  options: NormalizeDomainOptions = {},
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'IsDomainList',
      target: target.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      constraints: [options],
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          try {
            normalizeOrThrow(
              value,
              (args.constraints[0] as NormalizeDomainOptions | undefined) ?? {},
            );
            return true;
          } catch {
            return false;
          }
        },
        defaultMessage(args: ValidationArguments) {
          try {
            normalizeOrThrow(
              args.value,
              (args.constraints[0] as NormalizeDomainOptions | undefined) ?? {},
            );
            return `${args.property} contains invalid domain values`;
          } catch (error) {
            return error instanceof Error
              ? error.message
              : `${args.property} contains invalid domain values`;
          }
        },
      },
    });
  };
}
