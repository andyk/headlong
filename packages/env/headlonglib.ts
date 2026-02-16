import { RealtimeChannel } from "@supabase/supabase-js";
import { Database } from "./database.types";
import supabase from "./supabase";

type Thought = Database["public"]["Tables"]["thoughts"]["Row"];

export function registerThoughtHandler(
  handleThought: (thought: Thought) => Promise<void>,
  presenceKey?: string
): [RealtimeChannel, RealtimeChannel | null] {
  // use supabase client `supabase` to subscribe to the thoughts window
  const subChannel = supabase
    .channel("any")
    .on<Thought>(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "thoughts",
      },
      async (payload) => {
        if ("body" in payload.new) {
          handleThought(payload.new);
        }
      }
    )
    .subscribe();

  const presenceChannel =
    presenceKey === undefined
      ? null
      : supabase.channel("env_presence_room", {
          config: {
            presence: {
              key: "env",
            },
          },
        });

  return [subChannel, presenceChannel];
}
