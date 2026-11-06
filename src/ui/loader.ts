// Full-screen loading cover shown while a game mode warms up (shaders, geometry, first frames).
// Its sky-blue colours match the game so revealing the scene never jumps in brightness.

const $ = (id: string) => document.getElementById(id)!;

/**
 * Resolves on the next animation frame, or after 250 ms if frames are paused (hidden or
 * throttled page) so loading can never get stuck waiting.
 */
export const nextFrame = () =>
  new Promise<void>((r) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        r();
      }
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 250);
  });

export async function frames(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await nextFrame();
}

export class Loader {
  private el = $('loader');
  private text = $('loaderText');
  private fill = $('loaderFill');
  private hideTimer = 0;

  get visible(): boolean {
    return !this.el.classList.contains('hidden') && !this.el.classList.contains('fading');
  }

  /** Cover the screen. `label` empty = a quick plain cover (no text or bar). */
  async show(label: string): Promise<void> {
    window.clearTimeout(this.hideTimer);
    this.text.textContent = label;
    this.el.classList.toggle('plain', !label);
    this.progress(0);
    const wasHidden = this.el.classList.contains('hidden');
    this.el.classList.remove('hidden', 'fading');
    if (wasHidden && !label) {
      // a quick cover fades in so switching scenes is never a hard cut
      this.el.classList.add('fading');
      await nextFrame();
      this.el.classList.remove('fading');
      await new Promise((r) => setTimeout(r, 180));
    }
    await nextFrame();
  }

  progress(p: number): void {
    this.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, p))})`;
  }

  /** Gently fade out to reveal the ready scene. */
  hide(): Promise<void> {
    this.progress(1);
    this.el.classList.add('fading');
    return new Promise((r) => {
      this.hideTimer = window.setTimeout(() => {
        this.el.classList.add('hidden');
        r();
      }, 450);
    });
  }
}
