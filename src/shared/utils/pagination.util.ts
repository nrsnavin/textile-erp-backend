// src/shared/utils/pagination.util.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max, IsString, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

// ── PaginationDto — base class for all list query DTOs ────────────────────
// Extend this in every module's filter DTO:
//
//   export class OrderFilterDto extends PaginationDto {
//     @IsOptional() @IsEnum(OrderStatus)
//     status?: OrderStatus;
//   }

export class PaginationDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ example: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortDir?: 'asc' | 'desc' = 'desc';

  // Helper — skip value for Prisma queries
  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

// ── Paginated response builder ────────────────────────────────────────────
// Use in repository methods that return paginated lists.
//
// const [rows, total] = await prisma.$transaction([
//   prisma.order.findMany({ where, skip, take }),
//   prisma.order.count({ where }),
// ]);
// return paginate(rows, total, filters);

export function paginate<T>(
  data:    T[],
  total:   number,
  filters: PaginationDto,
): { data: T[]; meta: PaginationMeta } {
  return {
    data,
    meta: {
      page:  filters.page,
      limit: filters.limit,
      total,
      pages: Math.ceil(total / filters.limit),
    },
  };
}

export interface PaginationMeta {
  page:  number;
  limit: number;
  total: number;
  pages: number;
}

// ── Date range filter helper ───────────────────────────────────────────────
// Builds a Prisma date range filter from string inputs.
//
// Usage:
//   where: {
//     ...dateRangeFilter('createdAt', dto.from, dto.to)
//   }

export function dateRangeFilter(
  field: string,
  from?: string,
  to?:   string,
): Record<string, unknown> {
  if (!from && !to) return {};

  const filter: Record<string, Date> = {};
  if (from) filter.gte = new Date(from);
  if (to)   filter.lte = new Date(to);

  return { [field]: filter };
}

// ── String search helper ──────────────────────────────────────────────────
// Builds a Prisma contains filter for text search.
// Uses insensitive mode so search is case-independent.
//
// Usage:
//   where: {
//     poNumber: containsFilter(dto.search),
//   }

export function containsFilter(
  value?: string,
): { contains: string; mode: 'insensitive' } | undefined {
  if (!value?.trim()) return undefined;
  return { contains: value.trim(), mode: 'insensitive' };
}
