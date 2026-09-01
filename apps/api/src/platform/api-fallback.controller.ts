import { All, Controller, NotFoundException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

@ApiExcludeController()
@Controller()
export class ApiFallbackController {
  @All('{*path}')
  notFound(): never {
    throw new NotFoundException();
  }
}
