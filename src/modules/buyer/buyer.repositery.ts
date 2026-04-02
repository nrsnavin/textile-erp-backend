import { Injectable }    from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { Prisma }        from '@prisma/client';
import { CreateBuyerDto, UpdateBuyerDto, BuyerFilterDto } from './dto/buyer.dto';
import { paginate }      from '../../shared/utils/pagination.util';

@Injectable()
export class BuyersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBuyerDto, tenantId: string) {
    return this.prisma.buyer.create({
      data: {
        tenantId,
        name:     dto.name,
        country:  dto.country,
        email:    dto.email,
        phone:    dto.phone,
        currency: dto.currency ?? 'USD',
        address:  dto.address,
      },
    });
  }

  async findById(id: string, tenantId: string) {
    return this.prisma.buyer.findFirst({
      where: { id, tenantId },
    });
  }

  async findWithFilters(filters: BuyerFilterDto, tenantId: string) {
    const where: Prisma.BuyerWhereInput = {
      tenantId,
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
      ...(filters.country  && { country: filters.country }),
      ...(filters.search   && {
        OR: [
          { name:  { contains: filters.search, mode: 'insensitive' } },
          { email: { contains: filters.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.buyer.findMany({
        where,
        orderBy: { [filters.sortBy ?? 'name']: filters.sortDir ?? 'asc' },
        skip:    filters.skip,
        take:    filters.limit,
      }),
      this.prisma.buyer.count({ where }),
    ]);

    return paginate(rows, total, filters);
  }

  async update(id: string, tenantId: string, dto: UpdateBuyerDto) {
    return this.prisma.buyer.update({
      where: { id },
      data:  dto,
    });
  }

  async delete(id: string, tenantId: string) {
    return this.prisma.buyer.update({
      where: { id },
      data:  { isActive: false },
    });
  }
}