import { createContext } from "svelte";

export type ToastTone = "success" | "error" | "info";

export type ToastItem = {
  id: number;
  title: string;
  message: string;
  tone: ToastTone;
};

export class NotificationsController {
  items = $state<ToastItem[]>([]);
  #nextId = 1;
  #timers = new Map<number, number>();

  push(title: string, message: string, tone: ToastTone = "info", duration = 4200): number {
    const id = this.#nextId++;
    this.items = [...this.items, { id, title, message, tone }];

    if (typeof window !== "undefined" && duration > 0) {
      const timer = window.setTimeout(() => {
        this.dismiss(id);
      }, duration);
      this.#timers.set(id, timer);
    }

    return id;
  }

  success(message: string, title = "Saved") {
    return this.push(title, message, "success");
  }

  error(message: string, title = "Action failed") {
    return this.push(title, message, "error", 5200);
  }

  info(message: string, title = "Update") {
    return this.push(title, message, "info");
  }

  dismiss(id: number) {
    const timer = this.#timers.get(id);
    if (timer !== undefined && typeof window !== "undefined") {
      window.clearTimeout(timer);
      this.#timers.delete(id);
    }

    this.items = this.items.filter((item) => item.id !== id);
  }

  clear() {
    if (typeof window !== "undefined") {
      for (const timer of this.#timers.values()) {
        window.clearTimeout(timer);
      }
    }

    this.#timers.clear();
    this.items = [];
  }
}

export const [getNotifications, setNotifications] = createContext<NotificationsController>();
