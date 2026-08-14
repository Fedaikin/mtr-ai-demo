ALTER TABLE "position_analysis_results" ALTER COLUMN "responsibility" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "position_analysis_results" ALTER COLUMN "responsibility_confidence" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "position_analysis_results" ALTER COLUMN "responsibility_citation" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "position_analysis_results" ADD COLUMN "responsibility_decision_state" text;