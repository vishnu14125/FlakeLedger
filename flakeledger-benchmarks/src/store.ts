let items: string[] = [];

export function getItems() {
  return items;
}

export function addItem(item: string) {
  items.push(item);
}

export function clearItems() {
  items = [];
}
