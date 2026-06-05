import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import {
  DomainValidationError,
  normalizeDomain,
  NormalizeDomainOptions,
} from '../domain-utils';

@Injectable()
export class NormalizedDomainPipe implements PipeTransform<string, string> {
  constructor(private readonly options: NormalizeDomainOptions = {}) {}

  transform(value: string): string {
    try {
      return normalizeDomain(value, this.options);
    } catch (error) {
      if (error instanceof DomainValidationError) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }
}
