create index if not exists idx_activity_log_actor_id on public.activity_log(actor_id);
create index if not exists idx_activity_log_entity_id on public.activity_log(entity_id);
create index if not exists idx_activity_log_negotiation_id on public.activity_log(negotiation_id);
create index if not exists idx_activity_log_workspace_id on public.activity_log(workspace_id);

create index if not exists idx_contacts_entity_id on public.contacts(entity_id);
create index if not exists idx_contacts_workspace_id on public.contacts(workspace_id);

create index if not exists idx_custom_states_workspace_id on public.custom_states(workspace_id);

create index if not exists idx_deal_milestones_negotiation_id on public.deal_milestones(negotiation_id);
create index if not exists idx_deal_milestones_workspace_id on public.deal_milestones(workspace_id);

create index if not exists idx_documents_entity_id on public.documents(entity_id);
create index if not exists idx_documents_negotiation_id on public.documents(negotiation_id);
create index if not exists idx_documents_uploaded_by on public.documents(uploaded_by);
create index if not exists idx_documents_workspace_id on public.documents(workspace_id);

create index if not exists idx_entities_entity_type_id on public.entities(entity_type_id);
create index if not exists idx_entities_secondary_entity_type_id on public.entities(secondary_entity_type_id);

create index if not exists idx_entity_types_workspace_id on public.entity_types(workspace_id);

create index if not exists idx_invitations_workspace_id on public.invitations(workspace_id);

create index if not exists idx_negotiation_entities_entity_id on public.negotiation_entities(entity_id);

create index if not exists idx_negotiation_notes_created_by on public.negotiation_notes(created_by);
create index if not exists idx_negotiation_notes_entity_id on public.negotiation_notes(entity_id);
create index if not exists idx_negotiation_notes_negotiation_id on public.negotiation_notes(negotiation_id);
create index if not exists idx_negotiation_notes_product_id on public.negotiation_notes(product_id);
create index if not exists idx_negotiation_notes_workspace_id on public.negotiation_notes(workspace_id);

create index if not exists idx_negotiation_price_history_negotiation_id on public.negotiation_price_history(negotiation_id);
create index if not exists idx_negotiation_price_history_product_id on public.negotiation_price_history(product_id);
create index if not exists idx_negotiation_price_history_workspace_id on public.negotiation_price_history(workspace_id);

create index if not exists idx_negotiation_products_product_id on public.negotiation_products(product_id);

create index if not exists idx_negotiations_created_by on public.negotiations(created_by);
create index if not exists idx_negotiations_primary_entity_id on public.negotiations(primary_entity_id);
create index if not exists idx_negotiations_primary_product_id on public.negotiations(primary_product_id);
create index if not exists idx_negotiations_workspace_id on public.negotiations(workspace_id);

create index if not exists idx_notification_preferences_workspace_id on public.notification_preferences(workspace_id);

create index if not exists idx_notifications_entity_id on public.notifications(entity_id);
create index if not exists idx_notifications_negotiation_id on public.notifications(negotiation_id);
create index if not exists idx_notifications_task_id on public.notifications(task_id);
create index if not exists idx_notifications_user_id on public.notifications(user_id);
create index if not exists idx_notifications_workspace_id on public.notifications(workspace_id);

create index if not exists idx_product_types_workspace_id on public.product_types(workspace_id);

create index if not exists idx_products_entity_id on public.products(entity_id);
create index if not exists idx_products_product_type_id on public.products(product_type_id);
create index if not exists idx_products_workspace_id on public.products(workspace_id);

create index if not exists idx_tasks_assigned_to on public.tasks(assigned_to);
create index if not exists idx_tasks_created_by on public.tasks(created_by);
create index if not exists idx_tasks_entity_id on public.tasks(entity_id);
create index if not exists idx_tasks_negotiation_id on public.tasks(negotiation_id);
create index if not exists idx_tasks_predecessor_task_id on public.tasks(predecessor_task_id);
create index if not exists idx_tasks_workspace_id on public.tasks(workspace_id);

create index if not exists idx_workspace_members_user_id on public.workspace_members(user_id);

create index if not exists idx_workspaces_plan_id on public.workspaces(plan_id);
