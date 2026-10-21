import { z } from "zod";

import { emailSchema } from "./auth";
import { uuidSchema } from "./groups";

export const addFriendSchema = z.object({ email: emailSchema });

export const friendshipIdSchema = z.object({ friendshipId: uuidSchema });

export type AddFriendInput = z.input<typeof addFriendSchema>;
