import { Controller, Get, Post } from '@nestjs/common';
import { ControlService } from './control.service.js';

/** F6 kill switch: always available, also aliased by POST /apply/stop. */
@Controller()
export class ControlController {
  constructor(private readonly control: ControlService) {}

  @Get('control')
  state() {
    return this.control.state();
  }

  @Post('control/stop')
  stop() {
    return this.control.stop();
  }

  @Post('apply/stop')
  stopAlias() {
    return this.control.stop();
  }

  @Post('control/resume')
  resume() {
    return this.control.resume();
  }
}
