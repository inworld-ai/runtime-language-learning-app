export const dateWithMilliseconds = (date: Date) =>
  `${date.toLocaleString()}.${date.getMilliseconds()}`;
