export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      agents: {
        Row: {
          created_at: string
          name: string
          thoughts: Json
        }
        Insert: {
          created_at?: string
          name: string
          thoughts?: Json
        }
        Update: {
          created_at?: string
          name?: string
          thoughts?: Json
        }
        Relationships: []
      }
      agents_new_old: {
        Row: {
          name: string
          thought_set: string | null
          timestamp: string | null
        }
        Insert: {
          name: string
          thought_set?: string | null
          timestamp?: string | null
        }
        Update: {
          name?: string
          thought_set?: string | null
          timestamp?: string | null
        }
        Relationships: []
      }
      agents_old: {
        Row: {
          name: string
          timestamp: string
          uuid: string
        }
        Insert: {
          name: string
          timestamp?: string
          uuid: string
        }
        Update: {
          name?: string
          timestamp?: string
          uuid?: string
        }
        Relationships: []
      }
      agents_reboot: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      jsos_normalize: {
        Row: {
          denormalized: string
          normalized: string
        }
        Insert: {
          denormalized: string
          normalized: string
        }
        Update: {
          denormalized?: string
          normalized?: string
        }
        Relationships: [
          {
            foreignKeyName: "jsos_normalize_denormalized_fkey"
            columns: ["denormalized"]
            isOneToOne: false
            referencedRelation: "jsos_objects"
            referencedColumns: ["hash"]
          },
          {
            foreignKeyName: "jsos_normalize_normalized_fkey"
            columns: ["normalized"]
            isOneToOne: false
            referencedRelation: "jsos_objects"
            referencedColumns: ["hash"]
          }
        ]
      }
      jsos_objects: {
        Row: {
          hash: string
          json: Json | null
        }
        Insert: {
          hash: string
          json?: Json | null
        }
        Update: {
          hash?: string
          json?: Json | null
        }
        Relationships: []
      }
      jsos_var_lineage: {
        Row: {
          child_val_hash: string
          created_at: string
          parent_val_hash: string
        }
        Insert: {
          child_val_hash: string
          created_at?: string
          parent_val_hash: string
        }
        Update: {
          child_val_hash?: string
          created_at?: string
          parent_val_hash?: string
        }
        Relationships: []
      }
      jsos_vars: {
        Row: {
          name: string
          namespace: string | null
          subscription_uuid: string | null
          val_hash: string | null
        }
        Insert: {
          name: string
          namespace?: string | null
          subscription_uuid?: string | null
          val_hash?: string | null
        }
        Update: {
          name?: string
          namespace?: string | null
          subscription_uuid?: string | null
          val_hash?: string | null
        }
        Relationships: []
      }
      prompt_templates: {
        Row: {
          body: string | null
          name: string
          timestamp: string | null
          uuid: string
        }
        Insert: {
          body?: string | null
          name?: string
          timestamp?: string | null
          uuid?: string
        }
        Update: {
          body?: string | null
          name?: string
          timestamp?: string | null
          uuid?: string
        }
        Relationships: []
      }
      thought_history_old: {
        Row: {
          agent: string | null
          body: string | null
          context: Json | null
          label: string | null
          open_ai_embedding: string | null
          timestamp: string
          uuid: string
          version_uuid: string | null
        }
        Insert: {
          agent?: string | null
          body?: string | null
          context?: Json | null
          label?: string | null
          open_ai_embedding?: string | null
          timestamp?: string
          uuid?: string
          version_uuid?: string | null
        }
        Update: {
          agent?: string | null
          body?: string | null
          context?: Json | null
          label?: string | null
          open_ai_embedding?: string | null
          timestamp?: string
          uuid?: string
          version_uuid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "thought_history_old_agent_fkey"
            columns: ["agent"]
            isOneToOne: false
            referencedRelation: "agents_old"
            referencedColumns: ["uuid"]
          }
        ]
      }
      thought_sets: {
        Row: {
          thought: string
          uuid: string
        }
        Insert: {
          thought: string
          uuid?: string
        }
        Update: {
          thought?: string
          uuid?: string
        }
        Relationships: [
          {
            foreignKeyName: "thought_sets_thought_fkey"
            columns: ["thought"]
            isOneToOne: false
            referencedRelation: "thoughts_new_old"
            referencedColumns: ["uuid"]
          }
        ]
      }
      thoughts: {
        Row: {
          agent_name: string
          body: string
          created_at: string
          id: string
          index: number
          metadata: Json | null
          processed_at: string | null
        }
        Insert: {
          agent_name: string
          body?: string
          created_at?: string
          id?: string
          index: number
          metadata?: Json | null
          processed_at?: string | null
        }
        Update: {
          agent_name?: string
          body?: string
          created_at?: string
          id?: string
          index?: number
          metadata?: Json | null
          processed_at?: string | null
        }
        Relationships: []
      }
      thoughts_new_old: {
        Row: {
          agent: string | null
          body: string | null
          label: string | null
          parent: string | null
          uuid: string
        }
        Insert: {
          agent?: string | null
          body?: string | null
          label?: string | null
          parent?: string | null
          uuid?: string
        }
        Update: {
          agent?: string | null
          body?: string | null
          label?: string | null
          parent?: string | null
          uuid?: string
        }
        Relationships: []
      }
      thoughts_old: {
        Row: {
          agent: string | null
          body: string | null
          context: Json | null
          label: string | null
          open_ai_embedding: string | null
          timestamp: string | null
          uuid: string
        }
        Insert: {
          agent?: string | null
          body?: string | null
          context?: Json | null
          label?: string | null
          open_ai_embedding?: string | null
          timestamp?: string | null
          uuid?: string
        }
        Update: {
          agent?: string | null
          body?: string | null
          context?: Json | null
          label?: string | null
          open_ai_embedding?: string | null
          timestamp?: string | null
          uuid?: string
        }
        Relationships: [
          {
            foreignKeyName: "thoughts_old_agent_fkey"
            columns: ["agent"]
            isOneToOne: false
            referencedRelation: "agents_old"
            referencedColumns: ["uuid"]
          }
        ]
      }
      thoughts_test_bilbo_import: {
        Row: {
          agent_name: string
          body: string
          created_at: string
          id: string
          index: number
          metadata: Json | null
          processed_at: string | null
        }
        Insert: {
          agent_name: string
          body?: string
          created_at?: string
          id?: string
          index: number
          metadata?: Json | null
          processed_at?: string | null
        }
        Update: {
          agent_name?: string
          body?: string
          created_at?: string
          id?: string
          index?: number
          metadata?: Json | null
          processed_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_hashes: {
        Args: {
          hashes: string[]
        }
        Returns: string[]
      }
      get_jsons: {
        Args: {
          hashes: string[]
        }
        Returns: {
          hash: string
          json: Json | null
        }[]
      }
      get_thought_uuid_and_label: {
        Args: {
          thought_uuid: string
        }
        Returns: {
          uuid: string
          label: string
        }[]
      }
      hnswhandler: {
        Args: {
          "": unknown
        }
        Returns: unknown
      }
      ivfflathandler: {
        Args: {
          "": unknown
        }
        Returns: unknown
      }
      put_jsons: {
        Args: {
          objects: Database["public"]["CompositeTypes"]["jsos_object_type"][]
        }
        Returns: {
          hash: string
          json: Json | null
        }[]
      }
      vector_avg: {
        Args: {
          "": number[]
        }
        Returns: string
      }
      vector_dims: {
        Args: {
          "": string
        }
        Returns: number
      }
      vector_norm: {
        Args: {
          "": string
        }
        Returns: number
      }
      vector_out: {
        Args: {
          "": string
        }
        Returns: unknown
      }
      vector_send: {
        Args: {
          "": string
        }
        Returns: string
      }
      vector_typmod_in: {
        Args: {
          "": unknown[]
        }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      jsos_object_type: {
        hash: string
        json: Json
      }
    }
  }
}

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (Database["public"]["Tables"] & Database["public"]["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (Database["public"]["Tables"] &
      Database["public"]["Views"])
  ? (Database["public"]["Tables"] &
      Database["public"]["Views"])[PublicTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof Database["public"]["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof Database["public"]["Tables"]
  ? Database["public"]["Tables"][PublicTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof Database["public"]["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof Database["public"]["Tables"]
  ? Database["public"]["Tables"][PublicTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof Database["public"]["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof Database["public"]["Enums"]
  ? Database["public"]["Enums"][PublicEnumNameOrOptions]
  : never
