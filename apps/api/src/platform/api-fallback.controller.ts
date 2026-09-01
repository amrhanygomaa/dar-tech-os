import { All, Controller, NotFoundException } from '@nestjs/common';

@Controller()
export class ApiFallbackController {
  @All('{*path}')
  notFound(): never {
    throw new NotFoundException();
  }
}
