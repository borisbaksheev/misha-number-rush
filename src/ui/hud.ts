// DOM overlay: number badge, equations, milestone banners, toasts and screens.
import { formatNumber, numberToWords } from '../math/numberMath';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  private hud = $('hud');
  private badge = $('badge');
  private value = $('value');
  private words = $('words');
  private lap = $('lap');
  private team = $('team');
  private equation = $('equation');
  private banner = $('banner');
  private bannerText = this.banner.querySelector('.text') as HTMLElement;
  private toastEl = $('toast');
  private hint = $('hint');
  private hintText = $('hintText');
  private toastTimer = 0;
  private shown = '';

  show(visible: boolean): void {
    this.hud.classList.toggle('hidden', !visible);
    if (!visible) this.clearMessages();
  }

  /** Stop any equation, banner or toast that is still animating (e.g. when switching modes). */
  clearMessages(): void {
    this.equation.classList.remove('show');
    this.banner.classList.remove('show');
    this.toastEl.classList.remove('show');
    this.setTeam('');
  }

  setValue(n: number, animate = true): void {
    this.setValueText(formatNumber(n), numberToWords(n), n, animate);
  }

  /** Show a number given as text (exact fractions such as "3.5" with words "three point five"). */
  setValueText(text: string, words: string, magnitude: number, animate = true): void {
    if (text === this.shown) return;
    this.shown = text;
    this.value.textContent = text;
    this.words.textContent = words;
    this.badge.classList.toggle('gold', magnitude >= 1_000_000);
    if (animate) this.restartAnimation(this.badge, 'bump');
  }

  setLap(n: number): void {
    this.setPill(`Lap ${n}`);
  }

  /** Small pill at the top left (lap counter, distance …). */
  setPill(text: string): void {
    if (this.lap.textContent !== text) this.lap.textContent = text;
  }

  setHint(text: string): void {
    this.hintText.textContent = text;
  }

  setTeam(text: string): void {
    if (this.team.textContent !== text) this.team.textContent = text;
  }

  showEquation(text: string): void {
    this.equation.textContent = text;
    this.restartAnimation(this.equation, 'show');
  }

  showBanner(text: string): void {
    this.bannerText.textContent = text;
    this.restartAnimation(this.banner, 'show');
  }

  toast(text: string, seconds = 2.6): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), seconds * 1000);
  }

  showHint(visible: boolean): void {
    this.hint.classList.toggle('fade', !visible);
  }

  private restartAnimation(el: HTMLElement, cls: string): void {
    el.classList.remove(cls);
    void el.offsetWidth; // reflow so the CSS animation restarts
    el.classList.add(cls);
  }
}
