type Handler = (data: Record<string, unknown>) => void;

export class EventBus {
  private handlers = new Map<string, Handler[]>();
  private onceHandlers = new Map<string, Handler[]>();

  on(event: string, handler: Handler) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  once(event: string, handler: Handler) {
    const list = this.onceHandlers.get(event) ?? [];
    list.push(handler);
    this.onceHandlers.set(event, list);
  }

  emit(event: string, data: Record<string, unknown>) {
    for (const h of this.handlers.get(event) ?? []) h(data);
    const once = this.onceHandlers.get(event) ?? [];
    this.onceHandlers.delete(event);
    for (const h of once) h(data);
  }
}
