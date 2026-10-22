
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "attachments": {
                  Row: {
                    "created_at": string,"expense_id": string,"id": string,"mime_type": string,"size_bytes": number,"storage_path": string,"uploaded_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expense_id": string,"id"?: string,"mime_type": string,"size_bytes": number,"storage_path": string,"uploaded_by": string
                  }
                  Update: {
                    "created_at"?: string,"expense_id"?: string,"id"?: string,"mime_type"?: string,"size_bytes"?: number,"storage_path"?: string,"uploaded_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attachments_expense_id_fkey"
      columns: ["expense_id"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attachments_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_events": {
                  Row: {
                    "action": string,"actor_id": string | null,"after": Json | null,"before": Json | null,"created_at": string,"entity_id": string,"entity_type": string,"group_id": string | null,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"entity_id": string,"entity_type": string,"group_id"?: string | null,"id"?: string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"entity_id"?: string,"entity_type"?: string,"group_id"?: string | null,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audit_events_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    }
                  ]
                },"comments": {
                  Row: {
                    "author_id": string,"body": string,"created_at": string,"deleted_at": string | null,"expense_id": string,"id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"body": string,"created_at"?: string,"deleted_at"?: string | null,"expense_id": string,"id"?: string,"updated_at"?: string
                  }
                  Update: {
                    "author_id"?: string,"body"?: string,"created_at"?: string,"deleted_at"?: string | null,"expense_id"?: string,"id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "comments_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comments_expense_id_fkey"
      columns: ["expense_id"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["id"]
    }
                  ]
                },"expense_item_assignments": {
                  Row: {
                    "created_at": string,"id": string,"item_id": string,"user_id": string,"weight": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"item_id": string,"user_id": string,"weight"?: number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"item_id"?: string,"user_id"?: string,"weight"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "expense_item_assignments_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "expense_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expense_item_assignments_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"expense_items": {
                  Row: {
                    "allocation": string | null,"amount": number,"created_at": string,"expense_id": string,"id": string,"kind": string,"name": string,"position": number,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "allocation"?: string | null,"amount": number,"created_at"?: string,"expense_id": string,"id"?: string,"kind"?: string,"name": string,"position": number,"version": number
                  }
                  Update: {
                    "allocation"?: string | null,"amount"?: number,"created_at"?: string,"expense_id"?: string,"id"?: string,"kind"?: string,"name"?: string,"position"?: number,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "expense_items_expense_id_fkey"
      columns: ["expense_id"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["id"]
    }
                  ]
                },"expense_participants": {
                  Row: {
                    "amount": number,"basis_points": number | null,"created_at": string,"currency": string,"expense_id": string,"id": string,"received_rounding_unit": boolean,"user_id": string,"version": number,"weight": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"basis_points"?: number | null,"created_at"?: string,"currency": string,"expense_id": string,"id"?: string,"received_rounding_unit"?: boolean,"user_id": string,"version": number,"weight"?: number | null
                  }
                  Update: {
                    "amount"?: number,"basis_points"?: number | null,"created_at"?: string,"currency"?: string,"expense_id"?: string,"id"?: string,"received_rounding_unit"?: boolean,"user_id"?: string,"version"?: number,"weight"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "expense_participants_expense_id_fkey"
      columns: ["expense_id"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expense_participants_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"expense_payers": {
                  Row: {
                    "amount": number,"created_at": string,"currency": string,"expense_id": string,"id": string,"user_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"currency": string,"expense_id": string,"id"?: string,"user_id": string,"version": number
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"currency"?: string,"expense_id"?: string,"id"?: string,"user_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "expense_payers_expense_id_fkey"
      columns: ["expense_id"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expense_payers_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"expenses": {
                  Row: {
                    "amount": number,"cancelled_at": string | null,"cancelled_by": string | null,"category": string | null,"created_at": string,"created_by": string,"currency": string,"description": string,"expense_date": string,"group_id": string | null,"id": string,"idempotency_key": string,"notes": string | null,"split_method": string,"status": string,"tags": (string)[],"updated_at": string,"updated_by": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"category"?: string | null,"created_at"?: string,"created_by": string,"currency": string,"description": string,"expense_date": string,"group_id"?: string | null,"id"?: string,"idempotency_key": string,"notes"?: string | null,"split_method": string,"status"?: string,"tags"?: (string)[],"updated_at"?: string,"updated_by": string,"version"?: number
                  }
                  Update: {
                    "amount"?: number,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"category"?: string | null,"created_at"?: string,"created_by"?: string,"currency"?: string,"description"?: string,"expense_date"?: string,"group_id"?: string | null,"id"?: string,"idempotency_key"?: string,"notes"?: string | null,"split_method"?: string,"status"?: string,"tags"?: (string)[],"updated_at"?: string,"updated_by"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "expenses_cancelled_by_fkey"
      columns: ["cancelled_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"friendships": {
                  Row: {
                    "accepted_at": string | null,"created_at": string,"id": string,"requested_by": string,"status": string,"updated_at": string,"user_high": string,"user_low": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"created_at"?: string,"id"?: string,"requested_by": string,"status"?: string,"updated_at"?: string,"user_high": string,"user_low": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"created_at"?: string,"id"?: string,"requested_by"?: string,"status"?: string,"updated_at"?: string,"user_high"?: string,"user_low"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "friendships_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "friendships_user_high_fkey"
      columns: ["user_high"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "friendships_user_low_fkey"
      columns: ["user_low"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"group_invitations": {
                  Row: {
                    "created_at": string,"created_by": string,"expires_at": string,"group_id": string,"id": string,"invited_email": string | null,"max_uses": number,"revoked_at": string | null,"token_hash": string,"updated_at": string,"use_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"expires_at": string,"group_id": string,"id"?: string,"invited_email"?: string | null,"max_uses"?: number,"revoked_at"?: string | null,"token_hash": string,"updated_at"?: string,"use_count"?: number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"expires_at"?: string,"group_id"?: string,"id"?: string,"invited_email"?: string | null,"max_uses"?: number,"revoked_at"?: string | null,"token_hash"?: string,"updated_at"?: string,"use_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_invitations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_invitations_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    }
                  ]
                },"group_members": {
                  Row: {
                    "created_at": string,"group_id": string,"id": string,"joined_at": string,"left_at": string | null,"removed_by": string | null,"role": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"group_id": string,"id"?: string,"joined_at"?: string,"left_at"?: string | null,"removed_by"?: string | null,"role"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"group_id"?: string,"id"?: string,"joined_at"?: string,"left_at"?: string | null,"removed_by"?: string | null,"role"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_members_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_members_removed_by_fkey"
      columns: ["removed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"groups": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"created_by": string,"default_currency": string,"description": string | null,"group_type": string,"id": string,"name": string,"simplify_debts": boolean,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by": string,"default_currency"?: string,"description"?: string | null,"group_type"?: string,"id"?: string,"name": string,"simplify_debts"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string,"default_currency"?: string,"description"?: string | null,"group_type"?: string,"id"?: string,"name"?: string,"simplify_debts"?: boolean,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "groups_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"ledger_entries": {
                  Row: {
                    "amount": number,"created_at": string,"creditor_id": string,"currency": string,"debtor_id": string,"entry_type": string,"expense_id": string | null,"group_id": string | null,"id": string,"settlement_id": string | null,"source_version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"creditor_id": string,"currency": string,"debtor_id": string,"entry_type": string,"expense_id"?: string | null,"group_id"?: string | null,"id"?: string,"settlement_id"?: string | null,"source_version": number
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"creditor_id"?: string,"currency"?: string,"debtor_id"?: string,"entry_type"?: string,"expense_id"?: string | null,"group_id"?: string | null,"id"?: string,"settlement_id"?: string | null,"source_version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_entries_creditor_id_fkey"
      columns: ["creditor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_entries_debtor_id_fkey"
      columns: ["debtor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_entries_expense_id_fkey"
      columns: ["expense_id"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_entries_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_entries_settlement_id_fkey"
      columns: ["settlement_id"]
isOneToOne: false
      referencedRelation: "settlements"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_preferences": {
                  Row: {
                    "created_at": string,"email": boolean,"in_app": boolean,"type": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email"?: boolean,"in_app"?: boolean,"type": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"email"?: boolean,"in_app"?: boolean,"type"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_preferences_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"data": NonNullable<Json>,"expense_id": string | null,"group_id": string | null,"id": string,"read_at": string | null,"settlement_id": string | null,"type": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"data"?: NonNullable<Json>,"expense_id"?: string | null,"group_id"?: string | null,"id"?: string,"read_at"?: string | null,"settlement_id"?: string | null,"type": string,"user_id": string
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"data"?: NonNullable<Json>,"expense_id"?: string | null,"group_id"?: string | null,"id"?: string,"read_at"?: string | null,"settlement_id"?: string | null,"type"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_expense_id_fkey"
      columns: ["expense_id"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_settlement_id_fkey"
      columns: ["settlement_id"]
isOneToOne: false
      referencedRelation: "settlements"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"default_currency": string,"deleted_at": string | null,"display_name": string,"email": string | null,"id": string,"locale": string,"onboarded_at": string | null,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"default_currency"?: string,"deleted_at"?: string | null,"display_name": string,"email"?: string | null,"id": string,"locale"?: string,"onboarded_at"?: string | null,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"default_currency"?: string,"deleted_at"?: string | null,"display_name"?: string,"email"?: string | null,"id"?: string,"locale"?: string,"onboarded_at"?: string | null,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"recurring_expenses": {
                  Row: {
                    "amount": number,"category": string | null,"created_at": string,"created_by": string,"currency": string,"description": string,"end_date": string | null,"frequency": string,"group_id": string | null,"id": string,"ledger_entries": NonNullable<Json>,"next_occurrence_date": string | null,"payers": NonNullable<Json>,"shares": NonNullable<Json>,"split_method": string,"start_date": string,"status": string,"timezone": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"category"?: string | null,"created_at"?: string,"created_by": string,"currency": string,"description": string,"end_date"?: string | null,"frequency": string,"group_id"?: string | null,"id"?: string,"ledger_entries": NonNullable<Json>,"next_occurrence_date"?: string | null,"payers": NonNullable<Json>,"shares": NonNullable<Json>,"split_method": string,"start_date": string,"status"?: string,"timezone"?: string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "amount"?: number,"category"?: string | null,"created_at"?: string,"created_by"?: string,"currency"?: string,"description"?: string,"end_date"?: string | null,"frequency"?: string,"group_id"?: string | null,"id"?: string,"ledger_entries"?: NonNullable<Json>,"next_occurrence_date"?: string | null,"payers"?: NonNullable<Json>,"shares"?: NonNullable<Json>,"split_method"?: string,"start_date"?: string,"status"?: string,"timezone"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "recurring_expenses_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recurring_expenses_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    }
                  ]
                },"recurring_occurrences": {
                  Row: {
                    "created_at": string,"error": string | null,"expense_id": string | null,"id": string,"occurrence_date": string,"recurring_expense_id": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"error"?: string | null,"expense_id"?: string | null,"id"?: string,"occurrence_date": string,"recurring_expense_id": string,"status": string
                  }
                  Update: {
                    "created_at"?: string,"error"?: string | null,"expense_id"?: string | null,"id"?: string,"occurrence_date"?: string,"recurring_expense_id"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recurring_occurrences_expense_id_fkey"
      columns: ["expense_id"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recurring_occurrences_recurring_expense_id_fkey"
      columns: ["recurring_expense_id"]
isOneToOne: false
      referencedRelation: "recurring_expenses"
      referencedColumns: ["id"]
    }
                  ]
                },"settlements": {
                  Row: {
                    "amount": number,"batch_id": string | null,"cancelled_at": string | null,"cancelled_by": string | null,"confirmed_at": string | null,"created_at": string,"created_by": string,"currency": string,"group_id": string | null,"id": string,"idempotency_key": string,"method": string,"note": string | null,"payer_id": string,"receiver_id": string,"rejected_at": string | null,"settled_on": string,"status": string,"updated_at": string,"upi_reference": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"batch_id"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"confirmed_at"?: string | null,"created_at"?: string,"created_by": string,"currency": string,"group_id"?: string | null,"id"?: string,"idempotency_key": string,"method"?: string,"note"?: string | null,"payer_id": string,"receiver_id": string,"rejected_at"?: string | null,"settled_on"?: string,"status": string,"updated_at"?: string,"upi_reference"?: string | null
                  }
                  Update: {
                    "amount"?: number,"batch_id"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"confirmed_at"?: string | null,"created_at"?: string,"created_by"?: string,"currency"?: string,"group_id"?: string | null,"id"?: string,"idempotency_key"?: string,"method"?: string,"note"?: string | null,"payer_id"?: string,"receiver_id"?: string,"rejected_at"?: string | null,"settled_on"?: string,"status"?: string,"updated_at"?: string,"upi_reference"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "settlements_cancelled_by_fkey"
      columns: ["cancelled_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "settlements_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "settlements_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "settlements_payer_id_fkey"
      columns: ["payer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "settlements_receiver_id_fkey"
      columns: ["receiver_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_friend_request":
{ Args: { "p_friendship_id": string }; Returns: undefined
                           },
"accept_invitation":
{ Args: { "p_group_id"?: string,"p_invitation_id"?: string,"p_token"?: string }; Returns: string
                           },
"cancel_expense":
{ Args: { "p_expected_version": number,"p_expense_id": string }; Returns: undefined
                           },
"cancel_settlement":
{ Args: { "p_settlement_id": string }; Returns: undefined
                           },
"confirm_settlement":
{ Args: { "p_settlement_id": string }; Returns: undefined
                           },
"create_expense":
{ Args: { "p_amount": number,"p_category"?: string,"p_currency": string,"p_description": string,"p_expense_date": string,"p_group_id": string,"p_idempotency_key": string,"p_items"?: Json,"p_ledger_entries": Json,"p_notes"?: string,"p_participants": Json,"p_payers": Json,"p_split_method": string,"p_tags"?: (string)[] }; Returns: string
                           },
"create_group":
{ Args: { "p_default_currency"?: string,"p_description"?: string,"p_group_type"?: string,"p_name": string,"p_simplify_debts"?: boolean }; Returns: string
                           },
"create_invitation":
{ Args: { "p_expires_in_hours"?: number,"p_group_id": string,"p_invited_email"?: string,"p_max_uses"?: number }; Returns: {
              "invitation_id": string,"token": string
            }[]
                           },
"create_settlement":
{ Args: { "p_amount": number,"p_currency": string,"p_group_id": string,"p_idempotency_key": string,"p_method"?: string,"p_note"?: string,"p_payer_id": string,"p_receiver_id": string,"p_settled_on"?: string,"p_upi_reference"?: string }; Returns: string
                           },
"delete_friend_request":
{ Args: { "p_friendship_id": string }; Returns: undefined
                           },
"friend_balances":
{ Args: Record<PropertyKey, never>; Returns: {
              "amount": number,"currency": string,"friend_id": string
            }[]
                           },
"friend_group_balances":
{ Args: { "p_friend_id": string }; Returns: {
              "amount": number,"currency": string,"group_id": string
            }[]
                           },
"group_balances":
{ Args: { "p_group_id": string }; Returns: {
              "amount": number,"currency": string,"user_id": string
            }[]
                           },
"group_pairwise_balances":
{ Args: { "p_group_id": string }; Returns: {
              "amount": number,"creditor_id": string,"currency": string,"debtor_id": string
            }[]
                           },
"invitation_preview":
{ Args: { "p_group_id"?: string,"p_token": string }; Returns: {
              "expires_at": string,"group_id": string,"group_name": string,"group_type": string,"invited_email": string,"inviter_name": string,"member_count": number,"status": string
            }[]
                           },
"leave_group":
{ Args: { "p_group_id": string }; Returns: undefined
                           },
"my_activity":
{ Args: { "p_limit"?: number,"p_offset"?: number }; Returns: {
              "action": string,"actor_id": string,"after": Json,"before": Json,"created_at": string,"entity_id": string,"entity_type": string,"group_id": string,"id": string,"total_count": number
            }[]
                           },
"my_group_balances":
{ Args: Record<PropertyKey, never>; Returns: {
              "amount": number,"currency": string,"group_id": string
            }[]
                           },
"my_group_invitations":
{ Args: Record<PropertyKey, never>; Returns: {
              "expires_at": string,"group_id": string,"group_name": string,"group_type": string,"invitation_id": string,"inviter_name": string
            }[]
                           },
"profile_cards":
{ Args: { "p_user_ids": (string)[] }; Returns: {
              "avatar_url": string,"display_name": string,"id": string
            }[]
                           },
"reject_settlement":
{ Args: { "p_settlement_id": string }; Returns: undefined
                           },
"remove_group_member":
{ Args: { "p_group_id": string,"p_user_id": string }; Returns: undefined
                           },
"revoke_invitation":
{ Args: { "p_invitation_id": string }; Returns: undefined
                           },
"send_friend_request":
{ Args: { "p_email": string }; Returns: {
              "friend_id": string,"friendship_id": string,"status": string
            }[]
                           },
"set_member_role":
{ Args: { "p_group_id": string,"p_role": string,"p_user_id": string }; Returns: undefined
                           },
"settle_up_with_friend":
{ Args: { "p_friend_id": string,"p_idempotency_key": string,"p_method"?: string,"p_note"?: string,"p_settled_on"?: string,"p_upi_reference"?: string }; Returns: (string)[]
                           },
"update_expense":
{ Args: { "p_amount": number,"p_category"?: string,"p_currency": string,"p_description": string,"p_expected_version": number,"p_expense_date": string,"p_expense_id": string,"p_items"?: Json,"p_ledger_entries": Json,"p_notes"?: string,"p_participants": Json,"p_payers": Json,"p_split_method": string,"p_tags"?: (string)[] }; Returns: number
                           },
"update_group":
{ Args: { "p_default_currency": string,"p_description": string,"p_group_id": string,"p_group_type": string,"p_name": string,"p_simplify_debts": boolean }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
