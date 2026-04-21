import {
  createInitialDeviceActivationState,
  DeviceActivationControllerCore,
  type DeviceActivationClient,
  type DeviceActivationControllerConfig,
  type DeviceActivationOperationRef,
} from "./device_activation_controller.ts";

export type {
  DeviceActivationClient,
  DeviceActivationControllerConfig,
  DeviceActivationOperationRef,
} from "./device_activation_controller.ts";

export class DeviceActivationController extends DeviceActivationControllerCore {
  constructor(config: DeviceActivationControllerConfig) {
    super(config, $state(createInitialDeviceActivationState()));
  }
}

export function createDeviceActivationController(
  config: DeviceActivationControllerConfig,
): DeviceActivationController {
  return new DeviceActivationController(config);
}
