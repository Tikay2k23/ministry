ALTER TABLE "user_role_assignments" DROP CONSTRAINT "user_role_assignments_scope_person_id_hierarchy_nodes_person_id_fk";
--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_scope_person_id_people_id_fk" FOREIGN KEY ("scope_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;