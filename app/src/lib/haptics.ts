// Thin, silent-fail wrapper over @capacitor/haptics. A haptic is a garnish,
// never load-bearing: on the desktop or in a plain browser there is no
// native implementation, and that must never surface as an error.
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export function hapticTick(): void {
  void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

export function hapticApproval(): void {
  void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
}

export function hapticSuccess(): void {
  void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
}
