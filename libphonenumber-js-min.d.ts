declare module "libphonenumber-js/min" {
  export function isValidPhoneNumber(value: string): boolean;
  export function parsePhoneNumberFromString(value: string): { number: string; isValid(): boolean } | undefined;
}
