import { z } from "zod";

/** Supabase Auth's minimum (supabase/config.toml `minimum_password_length`). */
export const MIN_PASSWORD_LENGTH = 8;
/** bcrypt only uses the first 72 bytes; longer passwords would be silently truncated. */
export const MAX_PASSWORD_BYTES = 72;

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .max(254, "That email address is too long.")
  .toLowerCase()
  .pipe(z.email("Enter a valid email address."));

const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .refine((value) => new TextEncoder().encode(value).length <= MAX_PASSWORD_BYTES, {
    error: "That password is too long.",
  });

export const signUpSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(1024),
  next: z.string().max(2048).optional(),
});

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
});

export const resendConfirmationSchema = passwordResetRequestSchema;

export const updatePasswordSchema = z
  .object({
    password: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    error: "Passwords don't match.",
    path: ["confirmPassword"],
  });

export type SignUpInput = z.input<typeof signUpSchema>;
export type SignInInput = z.input<typeof signInSchema>;
export type PasswordResetRequestInput = z.input<typeof passwordResetRequestSchema>;
export type UpdatePasswordInput = z.input<typeof updatePasswordSchema>;
