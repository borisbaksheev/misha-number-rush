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
  private toastTimer = 0;
  private shown = -1;

  show(visible: boolean): void {
    this.hud.classList.toggle('hidden', !visible);
  }

  setValue(n: number, animate = true): void {
    if (n === this.shown) return;
    this.shown = n;
    this.value.textContent = formatNumber(n);
    this.words.textContent = numberToWords(n);
    this.badge.classList.toggle('gold', n >= 1_000_000);
    if (animate) this.restartAnimation(this.badge, 'bump');
  }

  setLap(n: number): void {
    this.lap.textContent = `Lap ${n}`;
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
