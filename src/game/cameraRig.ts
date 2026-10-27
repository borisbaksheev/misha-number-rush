// Smooth third-person chase camera with speed FOV, shake and short cinematic orbits.
import { PerspectiveCamera, Vector3 } from 'three';
import type { Frame } from './trackPath';

export class CameraRig {
  readonly camera: PerspectiveCamera;
  private pos = new Vector3();
  private look = new Vector3();
  private fwd = new Vector3(0, 0, -1);
  private upv = new Vector3(0, 1, 0);
  private shakeAmt = 0;
  private cinematic = 0;
  private cinematicDur = 0;
  private cinematicSide = 1;
  private initialised = false;
  baseFov = 60;
  /** 0..1 blend toward the title-screen orbit. */
  orbit = 0;
  private tmp = new Vector3();
  private tmp2 = new Vector3();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(60, aspect, 0.3, 3000);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    // keep roughly 62° of horizontal view in portrait; cap vertical fov in landscape
    const hFov = 64;
    const vFov = (2 * Math.atan(Math.tan((hFov * Math.PI) / 360) / aspect) * 180) / Math.PI;
    this.baseFov = Math.min(78, Math.max(52, vFov));
    this.camera.updateProjectionMatrix();
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(1, this.shakeAmt + amount);
  }

  /** Swing the camera round to the side to show off a transformation. */
  showcase(seconds: number): void {
    this.cinematic = seconds;
    this.cinematicDur = seconds;
    this.cinematicSide = Math.random() < 0.5 ? -1 : 1;
  }

  snap(): void {
    this.initialised = false;
  }

  update(dt: number, target: Vector3, frame: Frame, speed: number, airborne: boolean, time: number): void {
    // smooth track direction so curves feel fluid
    const k = 1 - Math.exp(-4 * dt);
    this.fwd.lerp(frame.tangent, k).normalize();
    this.upv.lerp(frame.up, k).normalize();
    const speedK = Math.min(1, speed / 26);
    const dist = 6.4 + speedK * 1.2;
    const height = 3.1 + speedK * 0.5 + (airborne ? 0.7 : 0);

    const desired = this.tmp.copy(target).addScaledVector(this.fwd, -dist).addScaledVector(this.upv, height);
    const lookAt = this.tmp2.copy(target).addScaledVector(this.fwd, 5).addScaledVector(this.upv, 1.5);

    // cinematic showcase: orbit to the front-side of the character
    let cin = 0;
    if (this.cinematic > 0) {
      this.cinematic = Math.max(0, this.cinematic - dt);
      const t = 1 - this.cinematic / this.cinematicDur;
      cin = Math.sin(Math.min(1, t) * Math.PI);
      const right = new Vector3().crossVectors(this.fwd, this.upv).normalize();
      const side = desired
        .clone()
        .copy(target)
        .addScaledVector(right, this.cinematicSide * 6.5)
        .addScaledVector(this.fwd, -4.5)
        .addScaledVector(this.upv, 2.4);
      desired.lerp(side, cin);
      lookAt.lerp(this.tmp.clone().copy(target).addScaledVector(this.upv, 1.2), cin);
    }

    // title orbit
    if (this.orbit > 0) {
      const a = time * 0.25;
      const right = new Vector3().crossVectors(this.fwd, this.upv).normalize();
      const orbitPos = target
        .clone()
        .addScaledVector(this.fwd, Math.cos(a) * -7)
        .addScaledVector(right, Math.sin(a) * 7)
        .addScaledVector(this.upv, 2.6);
      desired.lerp(orbitPos, this.orbit);
      lookAt.lerp(target.clone().addScaledVector(this.upv, 1.3), this.orbit);
    }

    if (!this.initialised) {
      this.pos.copy(desired);
      this.look.copy(lookAt);
      this.initialised = true;
    }
    const pk = 1 - Math.exp(-(7 + cin * 3) * dt);
    this.pos.lerp(desired, pk);
    this.look.lerp(lookAt, 1 - Math.exp(-10 * dt));

    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    const sh = this.shakeAmt * this.shakeAmt * 0.35;
    this.camera.position.set(
      this.pos.x + (Math.random() - 0.5) * sh,
      this.pos.y + (Math.random() - 0.5) * sh,
      this.pos.z + (Math.random() - 0.5) * sh,
    );
    this.camera.up.copy(this.upv);
    this.camera.lookAt(this.look);
    const fov = this.baseFov + speedK * 9 - cin * 8;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-4 * dt));
      this.camera.updateProjectionMatrix();
    }
  }
}
