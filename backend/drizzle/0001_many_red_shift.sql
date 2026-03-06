CREATE TABLE "adaptive_flow_thresholds" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"market_ticker" text NOT NULL,
	"window_hours" integer NOT NULL,
	"threshold_usd" numeric(20, 8) NOT NULL,
	"floor_usd" numeric(20, 8) NOT NULL,
	"p90_usd" numeric(20, 8) NOT NULL,
	"alpha_component_usd" numeric(20, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adaptive_flow_thresholds_run_market_window_unique" UNIQUE("run_id","market_ticker","window_hours")
);
--> statement-breakpoint
ALTER TABLE "adaptive_flow_thresholds" ADD CONSTRAINT "adaptive_flow_thresholds_run_id_analysis_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adaptive_flow_thresholds_market_created_idx" ON "adaptive_flow_thresholds" USING btree ("market_ticker","created_at");