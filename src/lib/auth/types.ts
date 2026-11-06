import type messages from "../../../messages/tr.json";

export type AuthErrorCode = keyof (typeof messages)["auth"]["errors"];

export type AuthField =
  | "username"
  | "email"
  | "password"
  | "confirm"
  | "birthDate"
  | "gender"
  | "terms";

export type AuthFormState = {
  status: "idle" | "error" | "success";
  error?: AuthErrorCode;
  fieldErrors?: Partial<Record<AuthField, AuthErrorCode>>;
  values?: Record<string, string>;
};

export const initialAuthState: AuthFormState = { status: "idle" };
