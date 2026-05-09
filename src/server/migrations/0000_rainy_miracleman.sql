CREATE TYPE "public"."session_side" AS ENUM('gold', 'silver');--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transcript" text NOT NULL,
	"gold_token_hash" text,
	"silver_token_hash" text,
	"accept_token_hash" text,
	"pending_side" "session_side",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
