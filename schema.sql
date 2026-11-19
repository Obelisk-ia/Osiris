CREATE TYPE "staff_role" AS ENUM ('owner', 'manager', 'chef', 'barista', 'bartender', 'waiter', 'cashier');

CREATE TYPE "dining_table_status" AS ENUM ('empty', 'occupied', 'attended', 'payment');

CREATE TYPE "order_status" AS ENUM ('ordered', 'preparing', 'ready', 'delivered');

CREATE TYPE "preparation_status" AS ENUM ('ordered', 'preparing', 'ready');

CREATE TYPE "inventory_unit" AS ENUM ('g', 'ml', 'each');

CREATE TYPE "inventory_movement_kind" AS ENUM ('receipt', 'consumption', 'waste', 'adjustment', 'transfer_in', 'transfer_out');

CREATE TYPE "table_shape" AS ENUM ('round', 'square', 'rectangle', 'oval');

CREATE TYPE "account_kind" AS ENUM ('dine_in', 'counter', 'takeaway', 'pickup');

CREATE TYPE "account_state" AS ENUM ('open', 'awaiting_payment', 'closed', 'voided');

CREATE TYPE "guest_submission_state" AS ENUM ('pending', 'accepted', 'rejected');

CREATE TYPE "service_request_kind" AS ENUM ('call_waiter', 'request_bill', 'collect_payment');

CREATE TYPE "service_request_state" AS ENUM ('pending', 'acknowledged', 'resolved', 'cancelled');

CREATE TABLE "organizations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "currency_code" text DEFAULT 'USD' NOT NULL,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "dish_categories" (
  "is_active" boolean DEFAULT true NOT NULL,
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "sort_order" integer NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "dish_ingredients" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "dish_id" uuid NOT NULL,
  "name" text,
  "quantity_text" text,
  PRIMARY KEY ("id")
);

CREATE TABLE "locations" (
  "time_zone" text DEFAULT 'UTC' NOT NULL,
  "guest_order_mode" text DEFAULT 'confirmation' NOT NULL,
  "max_pending_guest_orders" integer DEFAULT 10 NOT NULL,
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "address" text,
  "restrict_waiters_to_assigned_tables" boolean NOT NULL,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "service_mode" text,
  PRIMARY KEY ("id"),
  CONSTRAINT "locations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE "dishes" (
  "photo_bucket" text,
  "photo_path" text,
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "price" numeric(12,2) NOT NULL,
  "is_available" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "category_id" uuid,
  PRIMARY KEY ("id"),
  CONSTRAINT "dishes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "dishes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "dish_categories" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
);

CREATE TABLE "inventory_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "unit" "inventory_unit" NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "inventory_items_organization_id_name_key" UNIQUE ("organization_id", "name"),
  CONSTRAINT "inventory_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE TABLE "modifier_groups" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "min_selections" integer NOT NULL,
  "max_selections" integer,
  "sort_order" integer NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "modifier_groups_organization_id_name_key" UNIQUE ("organization_id", "name"),
  CONSTRAINT "modifier_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE "sections" (
  "canvas_x" numeric(12,2) DEFAULT 0.0 NOT NULL,
  "canvas_y" numeric(12,2) DEFAULT 0.0 NOT NULL,
  "canvas_width" numeric(12,2) DEFAULT 800.0 NOT NULL,
  "canvas_height" numeric(12,2) DEFAULT 600.0 NOT NULL,
  "canvas_rotation" numeric(7,2) DEFAULT 0.0 NOT NULL,
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "location_id" uuid NOT NULL,
  "name" text NOT NULL,
  "sort_order" integer NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "sections_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE "staff" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "location_id" uuid,
  "user_id" uuid NOT NULL,
  "role" "staff_role" NOT NULL,
  "display_name" text,
  "is_active" boolean NOT NULL,
  "created_at" timestamptz NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "staff_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "staff_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE "buffet_menus" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "location_id" uuid NOT NULL,
  "menu_date" date NOT NULL,
  "name" text NOT NULL,
  "is_active" boolean NOT NULL,
  "created_at" timestamptz NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "buffet_menus_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE "inventory_balances" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "location_id" uuid NOT NULL,
  "inventory_item_id" uuid NOT NULL,
  "quantity" numeric(18,6) DEFAULT 0.0 NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "inventory_balances_location_id_inventory_item_id_key" UNIQUE ("location_id", "inventory_item_id"),
  CONSTRAINT "inventory_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "inventory_balances_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE TABLE "recipe_ingredients" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "dish_id" uuid NOT NULL,
  "inventory_item_id" uuid NOT NULL,
  "quantity" numeric(18,6) NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "recipe_ingredients_dish_id_inventory_item_id_key" UNIQUE ("dish_id", "inventory_item_id"),
  CONSTRAINT "recipe_ingredients_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "recipe_ingredients_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE TABLE "inventory_movements" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "location_id" uuid NOT NULL,
  "inventory_item_id" uuid NOT NULL,
  "kind" "inventory_movement_kind" NOT NULL,
  "quantity_delta" numeric(18,6) NOT NULL,
  "reference_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "dish_id" uuid,
  "recipe_portions" numeric(18,6),
  "reason" text NOT NULL,
  "created_by" uuid,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "inventory_movements_reference_id_location_id_inventory_item_id_" UNIQUE ("reference_id", "location_id", "inventory_item_id"),
  CONSTRAINT "inventory_movements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "inventory_movements_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "inventory_movements_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE TABLE "table_types" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "location_id" uuid NOT NULL,
  "name" text NOT NULL,
  "shape" "table_shape" DEFAULT 'rectangle' NOT NULL,
  "seat_count" integer DEFAULT 2 NOT NULL,
  "width" numeric(12,2) DEFAULT 120.0 NOT NULL,
  "height" numeric(12,2) DEFAULT 80.0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "table_types_location_id_name_key" UNIQUE ("location_id", "name"),
  CONSTRAINT "table_types_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE "modifier_options" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "modifier_group_id" uuid NOT NULL,
  "name" text NOT NULL,
  "price_extra" numeric(12,2) DEFAULT 0.0 NOT NULL,
  "sort_order" integer NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "modifier_options_modifier_group_id_name_key" UNIQUE ("modifier_group_id", "name"),
  CONSTRAINT "modifier_options_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "modifier_options_modifier_group_id_fkey" FOREIGN KEY ("modifier_group_id") REFERENCES "modifier_groups" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE "dish_modifier_groups" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "dish_id" uuid NOT NULL,
  "modifier_group_id" uuid NOT NULL,
  "sort_order" integer NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "dish_modifier_groups_dish_id_modifier_group_id_key" UNIQUE ("dish_id", "modifier_group_id"),
  CONSTRAINT "dish_modifier_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "dish_modifier_groups_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "dish_modifier_groups_modifier_group_id_fkey" FOREIGN KEY ("modifier_group_id") REFERENCES "modifier_groups" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE "account_folio_counters" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "location_id" uuid NOT NULL UNIQUE,
  "next_folio" bigint DEFAULT 1 NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "account_folio_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "account_folio_counters_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE TABLE "dining_tables" (
  "location_id" uuid,
  "table_type_id" uuid,
  "seat_count" integer DEFAULT 2 NOT NULL,
  "shape" "table_shape" DEFAULT 'rectangle' NOT NULL,
  "canvas_x" numeric(12,2) DEFAULT 0.0 NOT NULL,
  "canvas_y" numeric(12,2) DEFAULT 0.0 NOT NULL,
  "canvas_width" numeric(12,2) DEFAULT 120.0 NOT NULL,
  "canvas_height" numeric(12,2) DEFAULT 80.0 NOT NULL,
  "canvas_rotation" numeric(7,2) DEFAULT 0.0 NOT NULL,
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "section_id" uuid NOT NULL,
  "table_number" text NOT NULL,
  "status" "dining_table_status" DEFAULT 'empty' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "qr_token" uuid DEFAULT gen_random_uuid() NOT NULL UNIQUE,
  "qr_enabled" boolean DEFAULT true NOT NULL,
  "qr_created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "assigned_staff_id" uuid,
  PRIMARY KEY ("id"),
  CONSTRAINT "dining_tables_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "dining_tables_table_type_id_fkey" FOREIGN KEY ("table_type_id") REFERENCES "table_types" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "dining_tables_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "dining_tables_assigned_staff_id_fkey" FOREIGN KEY ("assigned_staff_id") REFERENCES "staff" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
);

CREATE TABLE "preparation_stations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "location_id" uuid NOT NULL,
  "name" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "responsible_staff_id" uuid,
  PRIMARY KEY ("id"),
  CONSTRAINT "preparation_stations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "preparation_stations_responsible_staff_id_fkey" FOREIGN KEY ("responsible_staff_id") REFERENCES "staff" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
);

CREATE TABLE "buffet_menu_dishes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "buffet_menu_id" uuid NOT NULL,
  "dish_id" uuid NOT NULL,
  "sort_order" integer NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "buffet_menu_dishes_pair_key" UNIQUE ("buffet_menu_id", "dish_id"),
  CONSTRAINT "buffet_menu_dishes_buffet_menu_id_fkey" FOREIGN KEY ("buffet_menu_id") REFERENCES "buffet_menus" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "buffet_menu_dishes_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE "modifier_recipe_ingredients" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "modifier_option_id" uuid NOT NULL,
  "inventory_item_id" uuid NOT NULL,
  "quantity_delta" numeric(18,6) NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "modifier_recipe_ingredients_modifier_option_id_inventory_item_i" UNIQUE ("modifier_option_id", "inventory_item_id"),
  CONSTRAINT "modifier_recipe_ingredients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "modifier_recipe_ingredients_modifier_option_id_fkey" FOREIGN KEY ("modifier_option_id") REFERENCES "modifier_options" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "modifier_recipe_ingredients_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE TABLE "section_assignments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "section_id" uuid NOT NULL,
  "assigned_staff_id" uuid NOT NULL,
  "assigned_by_staff_id" uuid,
  "starts_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "ends_at" timestamptz,
  PRIMARY KEY ("id"),
  CONSTRAINT "section_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "section_assignments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "section_assignments_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "section_assignments_assigned_staff_id_fkey" FOREIGN KEY ("assigned_staff_id") REFERENCES "staff" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "section_assignments_assigned_by_staff_id_fkey" FOREIGN KEY ("assigned_by_staff_id") REFERENCES "staff" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
);

CREATE TABLE "dish_stations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "dish_id" uuid NOT NULL,
  "station_id" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "dish_stations_pair_key" UNIQUE ("dish_id", "station_id"),
  CONSTRAINT "dish_stations_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "dish_stations_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "preparation_stations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE "buffet_diners" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "dining_table_id" uuid NOT NULL,
  "seated_at" timestamptz NOT NULL,
  "finished_at" timestamptz,
  "is_active" boolean NOT NULL,
  "created_at" timestamptz NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "buffet_diners_dining_table_id_fkey" FOREIGN KEY ("dining_table_id") REFERENCES "dining_tables" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE "accounts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "section_id" uuid,
  "dining_table_id" uuid,
  "assigned_staff_id" uuid,
  "opened_by_staff_id" uuid,
  "kind" "account_kind" DEFAULT 'dine_in' NOT NULL,
  "state" "account_state" DEFAULT 'open' NOT NULL,
  "folio" bigint,
  "version" integer DEFAULT 1 NOT NULL,
  "request_id" uuid NOT NULL UNIQUE,
  "total_amount" numeric(12,2) DEFAULT 0.0 NOT NULL,
  "customer_name" text,
  "customer_phone" text,
  "phone_consent_at" timestamptz,
  "privacy_notice_version" text,
  "promised_at" timestamptz,
  "bill_requested_at" timestamptz,
  "closed_at" timestamptz,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "accounts_location_id_folio_key" UNIQUE ("location_id", "folio"),
  CONSTRAINT "accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "accounts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "accounts_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "accounts_dining_table_id_fkey" FOREIGN KEY ("dining_table_id") REFERENCES "dining_tables" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "accounts_assigned_staff_id_fkey" FOREIGN KEY ("assigned_staff_id") REFERENCES "staff" ("id") ON UPDATE NO ACTION ON DELETE SET NULL,
  CONSTRAINT "accounts_opened_by_staff_id_fkey" FOREIGN KEY ("opened_by_staff_id") REFERENCES "staff" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
);

CREATE TABLE "orders" (
  "account_id" uuid,
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "dining_table_id" uuid NOT NULL,
  "status" "order_status" DEFAULT 'ordered' NOT NULL,
  "comments" text,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "taken_by_staff_id" uuid,
  PRIMARY KEY ("id"),
  CONSTRAINT "orders_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "orders_dining_table_id_fkey" FOREIGN KEY ("dining_table_id") REFERENCES "dining_tables" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "orders_taken_by_staff_id_fkey" FOREIGN KEY ("taken_by_staff_id") REFERENCES "staff" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
);

CREATE TABLE "buffet_servings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "dining_table_id" uuid NOT NULL,
  "diner_id" uuid,
  "dish_id" uuid NOT NULL,
  "station_id" uuid,
  "status" text NOT NULL,
  "served_at" timestamptz NOT NULL,
  "finished_at" timestamptz,
  "created_at" timestamptz NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "buffet_servings_dining_table_id_fkey" FOREIGN KEY ("dining_table_id") REFERENCES "dining_tables" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "buffet_servings_diner_id_fkey" FOREIGN KEY ("diner_id") REFERENCES "buffet_diners" ("id") ON UPDATE NO ACTION ON DELETE SET NULL,
  CONSTRAINT "buffet_servings_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "buffet_servings_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "preparation_stations" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
);

CREATE TABLE "account_assignments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "previous_staff_id" uuid,
  "assigned_staff_id" uuid NOT NULL,
  "changed_by_staff_id" uuid NOT NULL,
  "reason" text,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "account_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "account_assignments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "account_assignments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "account_assignments_previous_staff_id_fkey" FOREIGN KEY ("previous_staff_id") REFERENCES "staff" ("id") ON UPDATE NO ACTION ON DELETE SET NULL,
  CONSTRAINT "account_assignments_assigned_staff_id_fkey" FOREIGN KEY ("assigned_staff_id") REFERENCES "staff" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "account_assignments_changed_by_staff_id_fkey" FOREIGN KEY ("changed_by_staff_id") REFERENCES "staff" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE TABLE "guest_sessions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "nickname" text,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "guest_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "guest_sessions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "guest_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE TABLE "guest_order_submissions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "guest_session_id" uuid NOT NULL,
  "request_id" uuid NOT NULL UNIQUE,
  "request_fingerprint" text,
  "state" "guest_submission_state" DEFAULT 'pending' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "reviewed_by_staff_id" uuid,
  "reviewed_at" timestamptz,
  "rejection_reason" text,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "guest_order_submissions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "guest_order_submissions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "guest_order_submissions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "guest_order_submissions_guest_session_id_fkey" FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "guest_order_submissions_reviewed_by_staff_id_fkey" FOREIGN KEY ("reviewed_by_staff_id") REFERENCES "staff" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
);

CREATE TABLE "service_requests" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "guest_session_id" uuid,
  "kind" "service_request_kind" NOT NULL,
  "state" "service_request_state" DEFAULT 'pending' NOT NULL,
  "request_id" uuid NOT NULL UNIQUE,
  "acknowledged_by_staff_id" uuid,
  "acknowledged_at" timestamptz,
  "resolved_at" timestamptz,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "service_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "service_requests_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "service_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "service_requests_guest_session_id_fkey" FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "service_requests_acknowledged_by_staff_id_fkey" FOREIGN KEY ("acknowledged_by_staff_id") REFERENCES "staff" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
);

CREATE TABLE "guest_order_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "submission_id" uuid NOT NULL,
  "dish_id" uuid NOT NULL,
  "dish_name" text NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "unit_price" numeric(12,2) NOT NULL,
  "comments" text,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "guest_order_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "guest_order_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "guest_order_items_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "guest_order_submissions" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "guest_order_items_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE TABLE "order_items" (
  "guest_order_item_id" uuid UNIQUE,
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "dish_id" uuid NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "unit_price" numeric(12,2) NOT NULL,
  "dish_name" text NOT NULL,
  "comments" text,
  "status" "order_status" DEFAULT 'ordered' NOT NULL,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "order_items_guest_order_item_id_fkey" FOREIGN KEY ("guest_order_item_id") REFERENCES "guest_order_items" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "order_items_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE TABLE "guest_order_item_modifiers" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "guest_order_item_id" uuid NOT NULL,
  "modifier_option_id" uuid,
  "group_name" text NOT NULL,
  "option_name" text NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "unit_price_extra" numeric(12,2) NOT NULL,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "guest_order_item_modifiers_guest_order_item_id_modifier_option_" UNIQUE ("guest_order_item_id", "modifier_option_id"),
  CONSTRAINT "guest_order_item_modifiers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "guest_order_item_modifiers_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "guest_order_item_modifiers_guest_order_item_id_fkey" FOREIGN KEY ("guest_order_item_id") REFERENCES "guest_order_items" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "guest_order_item_modifiers_modifier_option_id_fkey" FOREIGN KEY ("modifier_option_id") REFERENCES "modifier_options" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
);

CREATE TABLE "order_item_preparations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "order_item_id" uuid NOT NULL,
  "status" "preparation_status" DEFAULT 'ordered' NOT NULL,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "station_id" uuid,
  PRIMARY KEY ("id"),
  CONSTRAINT "order_item_preparations_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "order_item_preparations_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "preparation_stations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE "order_item_modifiers" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "order_item_id" uuid NOT NULL,
  "dish_id" uuid NOT NULL,
  "modifier_option_id" uuid,
  "group_name" text NOT NULL,
  "option_name" text NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "unit_price_extra" numeric(12,2) NOT NULL,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "order_item_modifiers_order_item_id_modifier_option_id_key" UNIQUE ("order_item_id", "modifier_option_id"),
  CONSTRAINT "order_item_modifiers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "order_item_modifiers_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "order_item_modifiers_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "order_item_modifiers_modifier_option_id_fkey" FOREIGN KEY ("modifier_option_id") REFERENCES "modifier_options" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
);

CREATE INDEX "dish_categories_sort_idx" ON "dish_categories" USING btree ("organization_id", "sort_order");

CREATE INDEX "dish_ingredients_dish_idx" ON "dish_ingredients" USING btree ("dish_id");

CREATE INDEX "locations_organization_idx" ON "locations" USING btree ("organization_id");

CREATE UNIQUE INDEX "locations_id_organization_id_scope_uidx" ON "locations" USING btree ("id", "organization_id");

CREATE INDEX "dishes_organization_idx" ON "dishes" USING btree ("organization_id");

CREATE INDEX "dishes_category_idx" ON "dishes" USING btree ("category_id");

CREATE UNIQUE INDEX "dishes_id_organization_id_scope_uidx" ON "dishes" USING btree ("id", "organization_id");

CREATE UNIQUE INDEX "inventory_items_id_organization_id_scope_uidx" ON "inventory_items" USING btree ("id", "organization_id");

CREATE UNIQUE INDEX "modifier_groups_id_organization_id_scope_uidx" ON "modifier_groups" USING btree ("id", "organization_id");

CREATE INDEX "sections_location_sort_idx" ON "sections" USING btree ("location_id", "sort_order");

CREATE UNIQUE INDEX "sections_id_location_id_scope_uidx" ON "sections" USING btree ("id", "location_id");

CREATE UNIQUE INDEX "staff_org_location_user_uidx" ON "staff" USING btree ("organization_id", "location_id", "user_id");

CREATE INDEX "staff_user_idx" ON "staff" USING btree ("user_id");

CREATE INDEX "staff_location_idx" ON "staff" USING btree ("location_id");

CREATE UNIQUE INDEX "staff_id_organization_id_scope_uidx" ON "staff" USING btree ("id", "organization_id");

CREATE INDEX "buffet_menus_location_date_idx" ON "buffet_menus" USING btree ("location_id", "menu_date");

CREATE INDEX "inventory_balances_item_idx" ON "inventory_balances" USING btree ("inventory_item_id");

CREATE INDEX "recipe_ingredients_item_idx" ON "recipe_ingredients" USING btree ("inventory_item_id");

CREATE INDEX "inventory_movements_stock_time_idx" ON "inventory_movements" USING btree ("location_id", "inventory_item_id", "created_at");

CREATE INDEX "inventory_movements_item_idx" ON "inventory_movements" USING btree ("inventory_item_id");

CREATE INDEX "inventory_movements_dish_idx" ON "inventory_movements" USING btree ("dish_id");

CREATE UNIQUE INDEX "table_types_id_location_id_scope_uidx" ON "table_types" USING btree ("id", "location_id");

CREATE UNIQUE INDEX "modifier_options_id_organization_id_scope_uidx" ON "modifier_options" USING btree ("id", "organization_id");

CREATE INDEX "modifier_options_organization_id_idx" ON "modifier_options" USING btree ("organization_id");

CREATE INDEX "dish_modifier_groups_organization_id_idx" ON "dish_modifier_groups" USING btree ("organization_id");

CREATE INDEX "dish_modifier_groups_modifier_group_id_idx" ON "dish_modifier_groups" USING btree ("modifier_group_id");

CREATE INDEX "account_folio_counters_organization_id_idx" ON "account_folio_counters" USING btree ("organization_id");

CREATE INDEX "dining_tables_assigned_staff_idx" ON "dining_tables" USING btree ("assigned_staff_id");

CREATE INDEX "dining_tables_section_number_idx" ON "dining_tables" USING btree ("section_id", "table_number");

CREATE UNIQUE INDEX "dining_tables_id_section_id_scope_uidx" ON "dining_tables" USING btree ("id", "section_id");

CREATE INDEX "dining_tables_location_idx" ON "dining_tables" USING btree ("location_id");

CREATE INDEX "dining_tables_table_type_idx" ON "dining_tables" USING btree ("table_type_id");

CREATE INDEX "preparation_stations_responsible_staff_idx" ON "preparation_stations" USING btree ("responsible_staff_id");

CREATE UNIQUE INDEX "preparation_stations_location_name_uidx" ON "preparation_stations" USING btree ("location_id", "name");

CREATE INDEX "buffet_menu_dishes_dish_idx" ON "buffet_menu_dishes" USING btree ("dish_id");

CREATE INDEX "modifier_recipe_ingredients_organization_id_idx" ON "modifier_recipe_ingredients" USING btree ("organization_id");

CREATE INDEX "modifier_recipe_ingredients_inventory_item_id_idx" ON "modifier_recipe_ingredients" USING btree ("inventory_item_id");

CREATE INDEX "section_assignments_organization_id_idx" ON "section_assignments" USING btree ("organization_id");

CREATE INDEX "section_assignments_location_id_idx" ON "section_assignments" USING btree ("location_id");

CREATE INDEX "section_assignments_section_id_idx" ON "section_assignments" USING btree ("section_id");

CREATE INDEX "section_assignments_assigned_staff_id_idx" ON "section_assignments" USING btree ("assigned_staff_id");

CREATE INDEX "section_assignments_assigned_by_staff_id_idx" ON "section_assignments" USING btree ("assigned_by_staff_id");

CREATE INDEX "dish_stations_station_idx" ON "dish_stations" USING btree ("station_id");

CREATE INDEX "buffet_diners_table_idx" ON "buffet_diners" USING btree ("dining_table_id");

CREATE UNIQUE INDEX "accounts_id_organization_id_location_id_scope_uidx" ON "accounts" USING btree ("id", "organization_id", "location_id");

CREATE UNIQUE INDEX "accounts_id_dining_table_id_scope_uidx" ON "accounts" USING btree ("id", "dining_table_id");

CREATE INDEX "accounts_organization_id_idx" ON "accounts" USING btree ("organization_id");

CREATE INDEX "accounts_section_id_idx" ON "accounts" USING btree ("section_id");

CREATE INDEX "accounts_dining_table_id_idx" ON "accounts" USING btree ("dining_table_id");

CREATE INDEX "accounts_assigned_staff_id_idx" ON "accounts" USING btree ("assigned_staff_id");

CREATE INDEX "accounts_opened_by_staff_id_idx" ON "accounts" USING btree ("opened_by_staff_id");

CREATE INDEX "orders_taken_by_staff_idx" ON "orders" USING btree ("taken_by_staff_id");

CREATE INDEX "orders_table_status_idx" ON "orders" USING btree ("dining_table_id", "status");

CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at");

CREATE INDEX "orders_account_idx" ON "orders" USING btree ("account_id");

CREATE INDEX "buffet_servings_diner_idx" ON "buffet_servings" USING btree ("diner_id");

CREATE INDEX "buffet_servings_dish_idx" ON "buffet_servings" USING btree ("dish_id");

CREATE INDEX "buffet_servings_station_idx" ON "buffet_servings" USING btree ("station_id");

CREATE INDEX "buffet_servings_table_status_idx" ON "buffet_servings" USING btree ("dining_table_id", "status");

CREATE INDEX "account_assignments_organization_id_idx" ON "account_assignments" USING btree ("organization_id");

CREATE INDEX "account_assignments_location_id_idx" ON "account_assignments" USING btree ("location_id");

CREATE INDEX "account_assignments_account_id_idx" ON "account_assignments" USING btree ("account_id");

CREATE INDEX "account_assignments_previous_staff_id_idx" ON "account_assignments" USING btree ("previous_staff_id");

CREATE INDEX "account_assignments_assigned_staff_id_idx" ON "account_assignments" USING btree ("assigned_staff_id");

CREATE INDEX "account_assignments_changed_by_staff_id_idx" ON "account_assignments" USING btree ("changed_by_staff_id");

CREATE UNIQUE INDEX "guest_sessions_id_account_id_organization_id_location_id_scope_" ON "guest_sessions" USING btree ("id", "account_id", "organization_id", "location_id");

CREATE INDEX "guest_sessions_organization_id_idx" ON "guest_sessions" USING btree ("organization_id");

CREATE INDEX "guest_sessions_location_id_idx" ON "guest_sessions" USING btree ("location_id");

CREATE UNIQUE INDEX "guest_sessions_bill_user_uidx" ON "guest_sessions" USING btree ("account_id", "user_id");

CREATE INDEX "guest_sessions_user_id_idx" ON "guest_sessions" USING btree ("user_id");

CREATE UNIQUE INDEX "guest_order_submissions_id_organization_id_location_id_scope_ui" ON "guest_order_submissions" USING btree ("id", "organization_id", "location_id");

CREATE INDEX "guest_order_submissions_organization_id_idx" ON "guest_order_submissions" USING btree ("organization_id");

CREATE INDEX "guest_order_submissions_location_id_idx" ON "guest_order_submissions" USING btree ("location_id");

CREATE INDEX "guest_order_submissions_account_id_idx" ON "guest_order_submissions" USING btree ("account_id");

CREATE INDEX "guest_order_submissions_guest_session_id_idx" ON "guest_order_submissions" USING btree ("guest_session_id");

CREATE INDEX "guest_order_submissions_reviewed_by_staff_id_idx" ON "guest_order_submissions" USING btree ("reviewed_by_staff_id");

CREATE INDEX "service_requests_organization_id_idx" ON "service_requests" USING btree ("organization_id");

CREATE INDEX "service_requests_location_id_idx" ON "service_requests" USING btree ("location_id");

CREATE INDEX "service_requests_account_id_idx" ON "service_requests" USING btree ("account_id");

CREATE INDEX "service_requests_guest_session_id_idx" ON "service_requests" USING btree ("guest_session_id");

CREATE INDEX "service_requests_acknowledged_by_staff_id_idx" ON "service_requests" USING btree ("acknowledged_by_staff_id");

CREATE UNIQUE INDEX "guest_order_items_id_organization_id_location_id_scope_uidx" ON "guest_order_items" USING btree ("id", "organization_id", "location_id");

CREATE UNIQUE INDEX "guest_order_items_id_dish_id_scope_uidx" ON "guest_order_items" USING btree ("id", "dish_id");

CREATE INDEX "guest_order_items_organization_id_idx" ON "guest_order_items" USING btree ("organization_id");

CREATE INDEX "guest_order_items_location_id_idx" ON "guest_order_items" USING btree ("location_id");

CREATE INDEX "guest_order_items_submission_id_idx" ON "guest_order_items" USING btree ("submission_id");

CREATE INDEX "guest_order_items_dish_id_idx" ON "guest_order_items" USING btree ("dish_id");

CREATE INDEX "order_items_dish_idx" ON "order_items" USING btree ("dish_id");

CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");

CREATE UNIQUE INDEX "order_items_id_dish_id_scope_uidx" ON "order_items" USING btree ("id", "dish_id");

CREATE INDEX "guest_order_item_modifiers_organization_id_idx" ON "guest_order_item_modifiers" USING btree ("organization_id");

CREATE INDEX "guest_order_item_modifiers_location_id_idx" ON "guest_order_item_modifiers" USING btree ("location_id");

CREATE INDEX "guest_order_item_modifiers_modifier_option_id_idx" ON "guest_order_item_modifiers" USING btree ("modifier_option_id");

CREATE UNIQUE INDEX "order_item_preparations_item_station_uidx" ON "order_item_preparations" USING btree ("order_item_id", "station_id");

CREATE INDEX "order_item_preparations_station_status_idx" ON "order_item_preparations" USING btree ("station_id", "status");

CREATE INDEX "order_item_modifiers_organization_id_idx" ON "order_item_modifiers" USING btree ("organization_id");

CREATE INDEX "order_item_modifiers_dish_id_idx" ON "order_item_modifiers" USING btree ("dish_id");

CREATE INDEX "order_item_modifiers_modifier_option_id_idx" ON "order_item_modifiers" USING btree ("modifier_option_id");

CREATE FUNCTION "sync_item_preparation_status"()
RETURNS trigger
LANGUAGE PLPGSQL
VOLATILE
SECURITY INVOKER
AS $function$
DECLARE v_item uuid; v_status order_status;
BEGIN
 IF TG_OP='DELETE' THEN v_item:=OLD.order_item_id; ELSE v_item:=NEW.order_item_id; END IF;
 PERFORM 1 FROM order_items WHERE id=v_item FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT CASE WHEN count(*)=0 THEN 'ready'::order_status
 WHEN bool_and(status='ready') THEN 'ready'::order_status
 WHEN bool_or(status<>'ordered') THEN 'preparing'::order_status
 ELSE 'ordered'::order_status END INTO v_status
 FROM order_item_preparations WHERE order_item_id=v_item;
 UPDATE order_items SET status=v_status
 WHERE id=v_item AND status<>'delivered' AND status IS DISTINCT FROM v_status;
 RETURN NULL;
END;
$function$;

CREATE FUNCTION "sync_order_item_status"()
RETURNS trigger
LANGUAGE PLPGSQL
VOLATILE
SECURITY INVOKER
AS $function$
DECLARE v_order uuid; v_status order_status;
BEGIN
 IF TG_OP='DELETE' THEN v_order:=OLD.order_id; ELSE v_order:=NEW.order_id; END IF;
 PERFORM 1 FROM orders WHERE id=v_order FOR UPDATE;
 SELECT CASE WHEN count(*)=0 THEN 'ordered'::order_status WHEN bool_and(status='delivered') THEN 'delivered'::order_status WHEN bool_and(status IN ('ready','delivered')) THEN 'ready'::order_status WHEN bool_or(status<>'ordered') THEN 'preparing'::order_status ELSE 'ordered'::order_status END INTO v_status FROM order_items WHERE order_id=v_order;
 UPDATE orders SET status=v_status,updated_at=now() WHERE id=v_order AND status IS DISTINCT FROM v_status;
 RETURN NULL;
END;
$function$;

CREATE FUNCTION "prepare_order_item"()
RETURNS trigger
LANGUAGE PLPGSQL
VOLATILE
SECURITY INVOKER
AS $function$ DECLARE d dishes%ROWTYPE; v_location uuid; v_org uuid; BEGIN IF TG_OP='UPDATE' THEN IF NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.dish_id IS DISTINCT FROM OLD.dish_id THEN RAISE EXCEPTION 'Order and dish identity cannot change after ordering' USING ERRCODE='23514'; END IF; ELSE SELECT * INTO d FROM dishes WHERE id=NEW.dish_id; IF NOT FOUND THEN RAISE EXCEPTION 'Dish does not exist' USING ERRCODE='23503'; END IF; SELECT s.location_id,l.organization_id INTO v_location,v_org FROM orders o JOIN dining_tables t ON t.id=o.dining_table_id JOIN sections s ON s.id=t.section_id JOIN locations l ON l.id=s.location_id WHERE o.id=NEW.order_id; IF NOT FOUND THEN RAISE EXCEPTION 'Order does not exist' USING ERRCODE='23503'; END IF; IF v_org IS DISTINCT FROM d.organization_id THEN RAISE EXCEPTION 'Dish must belong to the order organization' USING ERRCODE='23514'; END IF; IF NEW.unit_price IS NULL THEN NEW.unit_price := d.price; END IF; IF NEW.dish_name IS NULL THEN NEW.dish_name := d.name; END IF; NEW.status := 'ordered'; END IF; NEW.updated_at := now(); RETURN NEW; END; $function$;

CREATE FUNCTION "snapshot_order_item_preparations"()
RETURNS trigger
LANGUAGE PLPGSQL
VOLATILE
SECURITY INVOKER
AS $function$ DECLARE v_location uuid; BEGIN SELECT s.location_id INTO v_location FROM orders o JOIN dining_tables t ON t.id=o.dining_table_id JOIN sections s ON s.id=t.section_id WHERE o.id=NEW.order_id; INSERT INTO order_item_preparations(order_item_id,station_id) SELECT NEW.id, ds.station_id FROM dish_stations ds JOIN preparation_stations ps ON ps.id=ds.station_id WHERE ds.dish_id=NEW.dish_id AND ps.location_id=v_location AND ps.is_active; IF NOT EXISTS(SELECT 1 FROM order_item_preparations WHERE order_item_id=NEW.id) THEN UPDATE order_items SET status='ready' WHERE id=NEW.id; END IF; RETURN NEW; END; $function$;

CREATE FUNCTION "update_preparation_timestamp"()
RETURNS trigger
LANGUAGE PLPGSQL
VOLATILE
SECURITY INVOKER
AS $function$ BEGIN IF NEW.order_item_id IS DISTINCT FROM OLD.order_item_id OR NEW.station_id IS DISTINCT FROM OLD.station_id THEN RAISE EXCEPTION 'Preparation snapshot identity cannot change' USING ERRCODE='23514'; END IF; NEW.updated_at := now(); RETURN NEW; END; $function$;

CREATE FUNCTION "validate_restaurant_links"()
RETURNS trigger
LANGUAGE PLPGSQL
VOLATILE
SECURITY INVOKER
AS $function$ DECLARE v_location uuid; v_org uuid; v_other uuid; BEGIN IF TG_TABLE_NAME = 'preparation_stations' THEN IF TG_OP='UPDATE' AND NEW.location_id IS DISTINCT FROM OLD.location_id THEN RAISE EXCEPTION 'Station location cannot be changed; create a new station instead' USING ERRCODE='23514'; END IF; IF NEW.responsible_staff_id IS NOT NULL THEN SELECT location_id INTO v_other FROM staff WHERE id=NEW.responsible_staff_id; IF v_other IS NOT NULL AND NEW.location_id IS DISTINCT FROM v_other THEN RAISE EXCEPTION 'Station supervisor must belong to this restaurant' USING ERRCODE='23514'; END IF; END IF; ELSIF TG_TABLE_NAME = 'orders' THEN SELECT s.location_id INTO v_location FROM dining_tables t JOIN sections s ON s.id=t.section_id WHERE t.id=NEW.dining_table_id; IF TG_OP='UPDATE' AND NEW.dining_table_id IS DISTINCT FROM OLD.dining_table_id THEN RAISE EXCEPTION 'An existing order cannot move to another table' USING ERRCODE='23514'; END IF; IF NEW.taken_by_staff_id IS NOT NULL THEN SELECT location_id INTO v_other FROM staff WHERE id=NEW.taken_by_staff_id; IF v_other IS NOT NULL AND v_location IS DISTINCT FROM v_other THEN RAISE EXCEPTION 'Order taker must belong to the table restaurant' USING ERRCODE='23514'; END IF; END IF; NEW.updated_at := now(); ELSIF TG_TABLE_NAME = 'dining_tables' THEN IF TG_OP='UPDATE' AND NEW.section_id IS DISTINCT FROM OLD.section_id THEN SELECT location_id INTO v_other FROM sections WHERE id=OLD.section_id; SELECT s.location_id INTO v_location FROM sections s WHERE s.id=NEW.section_id; IF v_location IS DISTINCT FROM v_other THEN RAISE EXCEPTION 'Physical tables cannot move between restaurants' USING ERRCODE='23514'; END IF; END IF; ELSIF TG_TABLE_NAME = 'staff' THEN IF TG_OP='UPDATE' AND (NEW.location_id IS DISTINCT FROM OLD.location_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN RAISE EXCEPTION 'Staff identity cannot change; create another staff record instead' USING ERRCODE='23514'; END IF; ELSIF TG_TABLE_NAME = 'sections' THEN IF TG_OP='UPDATE' AND NEW.location_id IS DISTINCT FROM OLD.location_id THEN RAISE EXCEPTION 'Sections cannot move between restaurants' USING ERRCODE='23514'; END IF; ELSIF TG_TABLE_NAME = 'dish_stations' THEN SELECT organization_id INTO v_org FROM dishes WHERE id=NEW.dish_id; SELECT l.organization_id INTO v_other FROM preparation_stations p JOIN locations l ON l.id=p.location_id WHERE p.id=NEW.station_id; IF v_org IS DISTINCT FROM v_other THEN RAISE EXCEPTION 'Dish and station must belong to the same organization' USING ERRCODE='23514'; END IF; ELSIF TG_TABLE_NAME = 'dish_categories' THEN IF TG_OP='UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN RAISE EXCEPTION 'Organization ownership cannot change' USING ERRCODE='23514'; END IF; ELSE IF TG_OP='UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN RAISE EXCEPTION 'Organization ownership cannot change; create a separate record instead' USING ERRCODE='23514'; END IF; END IF; RETURN NEW; END; $function$;

CREATE FUNCTION "validate_buffet_links"()
RETURNS trigger
LANGUAGE PLPGSQL
VOLATILE
SECURITY INVOKER
AS $function$ DECLARE v_location uuid; v_org uuid; v_other uuid; BEGIN IF TG_TABLE_NAME = 'buffet_diners' THEN SELECT s.location_id INTO v_location FROM dining_tables t JOIN sections s ON s.id=t.section_id WHERE t.id=NEW.dining_table_id; IF NEW.finished_at IS NOT NULL AND NEW.finished_at < NEW.seated_at THEN RAISE EXCEPTION 'Diner cannot finish before seating' USING ERRCODE='23514'; END IF; ELSIF TG_TABLE_NAME = 'buffet_servings' THEN SELECT s.location_id INTO v_location FROM dining_tables t JOIN sections s ON s.id=t.section_id WHERE t.id=NEW.dining_table_id; IF NEW.diner_id IS NOT NULL THEN SELECT dining_table_id INTO v_other FROM buffet_diners WHERE id=NEW.diner_id; IF v_other IS DISTINCT FROM NEW.dining_table_id THEN RAISE EXCEPTION 'Diner must belong to the serving table' USING ERRCODE='23514'; END IF; END IF; IF NEW.station_id IS NOT NULL THEN SELECT location_id INTO v_other FROM preparation_stations WHERE id=NEW.station_id; IF v_location IS DISTINCT FROM v_other THEN RAISE EXCEPTION 'Station must belong to the serving table location' USING ERRCODE='23514'; END IF; END IF; IF NEW.finished_at IS NOT NULL AND NEW.finished_at < NEW.served_at THEN RAISE EXCEPTION 'Serving cannot finish before it is served' USING ERRCODE='23514'; END IF; ELSIF TG_TABLE_NAME = 'buffet_menu_dishes' THEN SELECT location_id INTO v_location FROM buffet_menus WHERE id=NEW.buffet_menu_id; SELECT l.organization_id INTO v_org FROM locations l WHERE l.id=v_location; SELECT organization_id INTO v_other FROM dishes WHERE id=NEW.dish_id; IF v_org IS DISTINCT FROM v_other THEN RAISE EXCEPTION 'Dish must belong to the buffet menu organization' USING ERRCODE='23514'; END IF; ELSIF TG_TABLE_NAME = 'buffet_menus' THEN IF TG_OP='UPDATE' AND NEW.location_id IS DISTINCT FROM OLD.location_id THEN RAISE EXCEPTION 'Buffet menu location cannot change' USING ERRCODE='23514'; END IF; END IF; RETURN NEW; END; $function$;

CREATE FUNCTION "validate_inventory_record"()
RETURNS trigger
LANGUAGE PLPGSQL
VOLATILE
SECURITY INVOKER
AS $function$
DECLARE v_org uuid; v_other uuid;
BEGIN
 IF TG_TABLE_NAME='inventory_items' THEN
  IF btrim(NEW.name)='' THEN RAISE EXCEPTION 'Inventory item name is required' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.unit IS DISTINCT FROM OLD.unit) THEN
   RAISE EXCEPTION 'Inventory identity, organization and base unit cannot change' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='recipe_ingredients' THEN
  IF NEW.quantity<=0 OR NEW.quantity::text IN ('NaN','Infinity','-Infinity') THEN
   RAISE EXCEPTION 'Recipe quantity must be finite and positive' USING ERRCODE='23514';
  END IF;
  SELECT organization_id INTO v_org FROM dishes WHERE id=NEW.dish_id;
  SELECT organization_id INTO v_other FROM inventory_items WHERE id=NEW.inventory_item_id AND is_active;
  IF v_org IS NULL OR v_other IS NULL OR v_org IS DISTINCT FROM v_other THEN
   RAISE EXCEPTION 'Recipe dish and active ingredient must belong to the same organization' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.dish_id IS DISTINCT FROM OLD.dish_id OR NEW.inventory_item_id IS DISTINCT FROM OLD.inventory_item_id) THEN
   RAISE EXCEPTION 'Recipe identity cannot change; replace the ingredient instead' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$function$;

CREATE FUNCTION "protect_inventory_balance"()
RETURNS trigger
LANGUAGE PLPGSQL
VOLATILE
SECURITY INVOKER
AS $function$
BEGIN
 IF TG_OP='DELETE' OR pg_trigger_depth()<2 THEN
  RAISE EXCEPTION 'Balances are maintained by stock movements; record a movement instead' USING ERRCODE='23514';
 END IF;
 IF NEW.quantity<0 OR NEW.quantity::text IN ('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION 'Insufficient inventory; stock cannot become negative' USING ERRCODE='23514';
 END IF;
 NEW.updated_at:=now();
 RETURN NEW;
END;
$function$;

CREATE FUNCTION "validate_inventory_movement"()
RETURNS trigger
LANGUAGE PLPGSQL
VOLATILE
SECURITY INVOKER
AS $function$
DECLARE v_org uuid; v_item_org uuid; v_dish_org uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'Inventory history is immutable; record a correcting movement' USING ERRCODE='23514';
 END IF;
 SELECT organization_id INTO v_org FROM locations WHERE id=NEW.location_id;
 SELECT organization_id INTO v_item_org FROM inventory_items WHERE id=NEW.inventory_item_id AND is_active;
 IF v_org IS NULL OR v_item_org IS NULL OR v_org IS DISTINCT FROM v_item_org THEN
  RAISE EXCEPTION 'Stock location and active inventory item must belong to the same organization' USING ERRCODE='23514';
 END IF;
 IF NEW.quantity_delta=0 OR NEW.quantity_delta::text IN ('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION 'Movement quantity must be finite and nonzero' USING ERRCODE='23514';
 END IF;
 IF (NEW.kind IN ('receipt','transfer_in') AND NEW.quantity_delta<0)
 OR (NEW.kind IN ('consumption','waste','transfer_out') AND NEW.quantity_delta>0) THEN
  RAISE EXCEPTION 'Movement sign does not match its kind' USING ERRCODE='23514';
 END IF;
 IF btrim(NEW.reason)='' THEN RAISE EXCEPTION 'Movement reason is required' USING ERRCODE='23514'; END IF;
 IF NEW.dish_id IS NOT NULL THEN
  SELECT organization_id INTO v_dish_org FROM dishes WHERE id=NEW.dish_id;
  IF v_dish_org IS DISTINCT FROM v_org OR NEW.kind<>'consumption' OR NEW.recipe_portions IS NULL
   OR NEW.recipe_portions<=0 OR NEW.recipe_portions::text IN ('NaN','Infinity','-Infinity') THEN
   RAISE EXCEPTION 'Recipe consumption requires a matching dish and positive portions' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.recipe_portions IS NOT NULL THEN
  RAISE EXCEPTION 'Recipe portions require a dish' USING ERRCODE='23514';
 END IF;
 NEW.created_by:=auth.uid();
 NEW.created_at:=now();
 -- Serialize one ingredient across locations, including concurrent transfers.
 PERFORM pg_advisory_xact_lock(hashtextextended('inventory-item:'||NEW.inventory_item_id::text,0));
 RETURN NEW;
END;
$function$;

CREATE FUNCTION "apply_inventory_movement"()
RETURNS trigger
LANGUAGE PLPGSQL
VOLATILE
SECURITY INVOKER
AS $function$
BEGIN
 INSERT INTO inventory_balances(location_id,inventory_item_id,quantity)
 VALUES(NEW.location_id,NEW.inventory_item_id,0)
 ON CONFLICT (location_id,inventory_item_id) DO NOTHING;
 UPDATE inventory_balances SET quantity=quantity+NEW.quantity_delta
 WHERE location_id=NEW.location_id AND inventory_item_id=NEW.inventory_item_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stock update is not permitted' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END;
$function$;

CREATE FUNCTION "consume_recipe"("p_location_id" uuid, "p_dish_id" uuid, "p_portions" pg_catalog.numeric, "p_reference_id" uuid)
RETURNS uuid
LANGUAGE PLPGSQL
VOLATILE
SECURITY INVOKER
AS $function$
DECLARE r record; previous inventory_movements%ROWTYPE; v_count integer:=0;
BEGIN
 IF p_reference_id IS NULL OR p_portions IS NULL OR p_portions<=0 OR p_portions::text IN ('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION 'Provide a request UUID and finite positive portions' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('inventory-request:'||p_reference_id::text,0));
 SELECT * INTO previous FROM inventory_movements WHERE reference_id=p_reference_id LIMIT 1;
 IF FOUND THEN
  IF previous.location_id IS DISTINCT FROM p_location_id OR previous.dish_id IS DISTINCT FROM p_dish_id
   OR previous.recipe_portions IS DISTINCT FROM p_portions OR previous.kind<>'consumption' THEN
   RAISE EXCEPTION 'Request UUID already used for a different operation' USING ERRCODE='23505';
  END IF;
  RETURN p_reference_id;
 END IF;
 FOR r IN SELECT inventory_item_id,quantity FROM recipe_ingredients WHERE dish_id=p_dish_id ORDER BY inventory_item_id LOOP
  INSERT INTO inventory_movements(location_id,inventory_item_id,kind,quantity_delta,reference_id,dish_id,recipe_portions,reason)
  VALUES(p_location_id,r.inventory_item_id,'consumption',-(r.quantity*p_portions),p_reference_id,p_dish_id,p_portions,'Recipe preparation');
  v_count:=v_count+1;
 END LOOP;
 IF v_count=0 THEN RAISE EXCEPTION 'Dish has no accessible inventory recipe' USING ERRCODE='23514'; END IF;
 RETURN p_reference_id;
END;
$function$;

CREATE FUNCTION "transfer_inventory"("p_from_location_id" uuid, "p_to_location_id" uuid, "p_inventory_item_id" uuid, "p_quantity" pg_catalog.numeric, "p_reference_id" uuid)
RETURNS uuid
LANGUAGE PLPGSQL
VOLATILE
SECURITY INVOKER
AS $function$
DECLARE v_count integer;
BEGIN
 IF p_reference_id IS NULL OR p_from_location_id IS NULL OR p_to_location_id IS NULL OR p_inventory_item_id IS NULL
 OR p_from_location_id=p_to_location_id OR p_quantity IS NULL OR p_quantity<=0 OR p_quantity::text IN ('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION 'Transfer requires different locations, an item, a request UUID and positive quantity' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('inventory-request:'||p_reference_id::text,0));
 SELECT count(*) INTO v_count FROM inventory_movements WHERE reference_id=p_reference_id;
 IF v_count>0 THEN
  IF v_count<>2 OR NOT EXISTS(SELECT 1 FROM inventory_movements WHERE reference_id=p_reference_id AND location_id=p_from_location_id AND inventory_item_id=p_inventory_item_id AND kind='transfer_out' AND quantity_delta=-p_quantity)
   OR NOT EXISTS(SELECT 1 FROM inventory_movements WHERE reference_id=p_reference_id AND location_id=p_to_location_id AND inventory_item_id=p_inventory_item_id AND kind='transfer_in' AND quantity_delta=p_quantity) THEN
   RAISE EXCEPTION 'Request UUID already used for a different operation' USING ERRCODE='23505';
  END IF;
  RETURN p_reference_id;
 END IF;
 INSERT INTO inventory_movements(location_id,inventory_item_id,kind,quantity_delta,reference_id,reason)
 VALUES(p_from_location_id,p_inventory_item_id,'transfer_out',-p_quantity,p_reference_id,'Stock transfer');
 INSERT INTO inventory_movements(location_id,inventory_item_id,kind,quantity_delta,reference_id,reason)
 VALUES(p_to_location_id,p_inventory_item_id,'transfer_in',p_quantity,p_reference_id,'Stock transfer');
 RETURN p_reference_id;
END;
$function$;

CREATE TRIGGER "preserve_location_organization" BEFORE UPDATE ON "locations" FOR EACH ROW EXECUTE FUNCTION "validate_restaurant_links"();

CREATE TRIGGER "prepare_order_item_before_write" BEFORE INSERT OR UPDATE ON "order_items" FOR EACH ROW EXECUTE FUNCTION "prepare_order_item"();

CREATE TRIGGER "snapshot_item_preparations" AFTER INSERT ON "order_items" FOR EACH ROW EXECUTE FUNCTION "snapshot_order_item_preparations"();

CREATE TRIGGER "sync_order_after_item_write" AFTER INSERT OR DELETE OR UPDATE ON "order_items" FOR EACH ROW EXECUTE FUNCTION "sync_order_item_status"();

CREATE TRIGGER "validate_dish_station_organization" BEFORE INSERT OR UPDATE ON "dish_stations" FOR EACH ROW EXECUTE FUNCTION "validate_restaurant_links"();

CREATE TRIGGER "validate_category_organization" BEFORE INSERT OR UPDATE ON "dish_categories" FOR EACH ROW EXECUTE FUNCTION "validate_restaurant_links"();

CREATE TRIGGER "preserve_staff_identity" BEFORE UPDATE ON "staff" FOR EACH ROW EXECUTE FUNCTION "validate_restaurant_links"();

CREATE TRIGGER "validate_buffet_diner" BEFORE INSERT OR UPDATE ON "buffet_diners" FOR EACH ROW EXECUTE FUNCTION "validate_buffet_links"();

CREATE TRIGGER "validate_buffet_serving" BEFORE INSERT OR UPDATE ON "buffet_servings" FOR EACH ROW EXECUTE FUNCTION "validate_buffet_links"();

CREATE TRIGGER "validate_buffet_menu_dish" BEFORE INSERT OR UPDATE ON "buffet_menu_dishes" FOR EACH ROW EXECUTE FUNCTION "validate_buffet_links"();

CREATE TRIGGER "preserve_buffet_menu_location" BEFORE UPDATE ON "buffet_menus" FOR EACH ROW EXECUTE FUNCTION "validate_buffet_links"();

CREATE TRIGGER "preparation_before_update" BEFORE UPDATE ON "order_item_preparations" FOR EACH ROW EXECUTE FUNCTION "update_preparation_timestamp"();

CREATE TRIGGER "preparation_after_write" AFTER INSERT OR DELETE OR UPDATE ON "order_item_preparations" FOR EACH ROW EXECUTE FUNCTION "sync_item_preparation_status"();

CREATE TRIGGER "validate_order_links" BEFORE INSERT OR UPDATE ON "orders" FOR EACH ROW EXECUTE FUNCTION "validate_restaurant_links"();

CREATE TRIGGER "validate_station_links" BEFORE INSERT OR UPDATE ON "preparation_stations" FOR EACH ROW EXECUTE FUNCTION "validate_restaurant_links"();

CREATE TRIGGER "preserve_table_location" BEFORE UPDATE ON "dining_tables" FOR EACH ROW EXECUTE FUNCTION "validate_restaurant_links"();

CREATE TRIGGER "preserve_section_location" BEFORE UPDATE ON "sections" FOR EACH ROW EXECUTE FUNCTION "validate_restaurant_links"();

CREATE TRIGGER "preserve_dish_organization" BEFORE UPDATE ON "dishes" FOR EACH ROW EXECUTE FUNCTION "validate_restaurant_links"();

CREATE TRIGGER "validate_inventory_item" BEFORE INSERT OR UPDATE ON "inventory_items" FOR EACH ROW EXECUTE FUNCTION "validate_inventory_record"();

CREATE TRIGGER "validate_recipe_ingredient" BEFORE INSERT OR UPDATE ON "recipe_ingredients" FOR EACH ROW EXECUTE FUNCTION "validate_inventory_record"();

CREATE TRIGGER "protect_inventory_balances" BEFORE INSERT OR DELETE OR UPDATE ON "inventory_balances" FOR EACH ROW EXECUTE FUNCTION "protect_inventory_balance"();

CREATE TRIGGER "validate_inventory_movement" BEFORE INSERT OR DELETE OR UPDATE ON "inventory_movements" FOR EACH ROW EXECUTE FUNCTION "validate_inventory_movement"();

CREATE TRIGGER "apply_inventory_movement" AFTER INSERT ON "inventory_movements" FOR EACH ROW EXECUTE FUNCTION "apply_inventory_movement"();

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_owner_admin_full_access" ON "organizations" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" = "organizations"."id" AND "staff"."is_active")) WITH CHECK (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" = "organizations"."id" AND "staff"."is_active"));

ALTER TABLE "dish_categories" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_write" ON "dish_categories" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" = "dish_categories"."organization_id" AND "staff"."is_active")) WITH CHECK (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" = "dish_categories"."organization_id" AND "staff"."is_active"));

ALTER TABLE "dish_ingredients" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_write" ON "dish_ingredients" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" IN (SELECT "organization_id" FROM "dishes" WHERE "dishes"."id" = "dish_ingredients"."dish_id") AND "staff"."is_active")) WITH CHECK (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" IN (SELECT "organization_id" FROM "dishes" WHERE "dishes"."id" = "dish_ingredients"."dish_id") AND "staff"."is_active"));

ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_write_all" ON "locations" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" = "locations"."organization_id" AND "staff"."is_active")) WITH CHECK (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" = "locations"."organization_id" AND "staff"."is_active"));

ALTER TABLE "dishes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_write" ON "dishes" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" = "dishes"."organization_id" AND "staff"."is_active")) WITH CHECK (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" = "dishes"."organization_id" AND "staff"."is_active"));

ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_items_read" ON "inventory_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=inventory_items.organization_id AND s.is_active));

CREATE POLICY "inventory_items_manage" ON "inventory_items" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=inventory_items.organization_id AND s.is_active AND s.role IN ('owner','manager'))) WITH CHECK (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=inventory_items.organization_id AND s.is_active AND s.role IN ('owner','manager')));

ALTER TABLE "modifier_groups" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "modifier_groups_read" ON "modifier_groups" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=modifier_groups.organization_id AND s.is_active));

CREATE POLICY "modifier_groups_manage" ON "modifier_groups" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=modifier_groups.organization_id AND s.is_active AND s.role IN ('owner','manager'))) WITH CHECK (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=modifier_groups.organization_id AND s.is_active AND s.role IN ('owner','manager')));

ALTER TABLE "sections" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_write" ON "sections" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS (SELECT 1 FROM "staff" s JOIN "locations" l ON l.organization_id = s.organization_id WHERE s.user_id = auth.uid() AND l.id = "sections"."location_id" AND s.is_active)) WITH CHECK (EXISTS (SELECT 1 FROM "staff" s JOIN "locations" l ON l.organization_id = s.organization_id WHERE s.user_id = auth.uid() AND l.id = "sections"."location_id" AND s.is_active));

ALTER TABLE "staff" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_select_own" ON "staff" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("user_id" = auth.uid());

CREATE POLICY "staff_insert_service_role" ON "staff" AS PERMISSIVE FOR INSERT TO "service_role" WITH CHECK (true);

ALTER TABLE "buffet_menus" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_write" ON "buffet_menus" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" IN (SELECT "organization_id" FROM "locations" WHERE "locations"."id" = "buffet_menus"."location_id") AND "staff"."is_active")) WITH CHECK (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" IN (SELECT "organization_id" FROM "locations" WHERE "locations"."id" = "buffet_menus"."location_id") AND "staff"."is_active"));

ALTER TABLE "inventory_balances" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_balances_read" ON "inventory_balances" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS(SELECT 1 FROM staff s JOIN locations l ON l.organization_id=s.organization_id WHERE l.id=inventory_balances.location_id AND s.user_id=(SELECT auth.uid()) AND s.is_active AND (s.location_id=l.id OR (s.location_id IS NULL AND s.role IN ('owner','manager'))))));

CREATE POLICY "inventory_balances_insert" ON "inventory_balances" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (EXISTS(SELECT 1 FROM staff s JOIN locations l ON l.organization_id=s.organization_id WHERE l.id=inventory_balances.location_id AND s.user_id=(SELECT auth.uid()) AND s.is_active AND s.role IN ('owner','manager','chef','barista','bartender') AND (s.location_id=l.id OR (s.location_id IS NULL AND s.role IN ('owner','manager')))));

CREATE POLICY "inventory_balances_update" ON "inventory_balances" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s JOIN locations l ON l.organization_id=s.organization_id WHERE l.id=inventory_balances.location_id AND s.user_id=(SELECT auth.uid()) AND s.is_active AND s.role IN ('owner','manager','chef','barista','bartender') AND (s.location_id=l.id OR (s.location_id IS NULL AND s.role IN ('owner','manager'))))) WITH CHECK (EXISTS(SELECT 1 FROM staff s JOIN locations l ON l.organization_id=s.organization_id WHERE l.id=inventory_balances.location_id AND s.user_id=(SELECT auth.uid()) AND s.is_active AND s.role IN ('owner','manager','chef','barista','bartender') AND (s.location_id=l.id OR (s.location_id IS NULL AND s.role IN ('owner','manager')))));

ALTER TABLE "recipe_ingredients" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipe_read" ON "recipe_ingredients" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS(SELECT 1 FROM dishes d JOIN staff s ON s.organization_id=d.organization_id WHERE d.id=recipe_ingredients.dish_id AND s.user_id=(SELECT auth.uid()) AND s.is_active));

CREATE POLICY "recipe_manage" ON "recipe_ingredients" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS(SELECT 1 FROM dishes d JOIN staff s ON s.organization_id=d.organization_id WHERE d.id=recipe_ingredients.dish_id AND s.user_id=(SELECT auth.uid()) AND s.is_active AND s.role IN ('owner','manager'))) WITH CHECK (EXISTS(SELECT 1 FROM dishes d JOIN staff s ON s.organization_id=d.organization_id WHERE d.id=recipe_ingredients.dish_id AND s.user_id=(SELECT auth.uid()) AND s.is_active AND s.role IN ('owner','manager')));

ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_movements_read" ON "inventory_movements" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS(SELECT 1 FROM staff s JOIN locations l ON l.organization_id=s.organization_id WHERE l.id=inventory_movements.location_id AND s.user_id=(SELECT auth.uid()) AND s.is_active AND (s.location_id=l.id OR (s.location_id IS NULL AND s.role IN ('owner','manager'))))));

CREATE POLICY "inventory_movements_insert" ON "inventory_movements" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((EXISTS(SELECT 1 FROM staff s JOIN locations l ON l.organization_id=s.organization_id WHERE l.id=inventory_movements.location_id AND s.user_id=(SELECT auth.uid()) AND s.is_active AND (s.location_id=l.id OR (s.location_id IS NULL AND s.role IN ('owner','manager'))))) AND (
 (EXISTS(SELECT 1 FROM staff s JOIN locations l ON l.organization_id=s.organization_id WHERE l.id=inventory_movements.location_id AND s.user_id=(SELECT auth.uid()) AND s.is_active AND (s.location_id=l.id OR (s.location_id IS NULL AND s.role IN ('owner','manager'))) AND s.role IN ('owner','manager'))) OR
 (kind IN ('consumption','waste') AND EXISTS(SELECT 1 FROM staff s JOIN locations l ON l.organization_id=s.organization_id WHERE l.id=inventory_movements.location_id AND s.user_id=(SELECT auth.uid()) AND s.is_active AND s.role IN ('chef','barista','bartender') AND s.location_id=l.id))
));

ALTER TABLE "table_types" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "table_types_read" ON "table_types" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s JOIN locations l ON l.organization_id=s.organization_id WHERE l.id=table_types.location_id AND s.user_id=(SELECT auth.uid()) AND s.is_active AND (s.location_id=l.id OR (s.location_id IS NULL AND s.role IN ('owner','manager')))));

CREATE POLICY "table_types_manage" ON "table_types" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s JOIN locations l ON l.organization_id=s.organization_id WHERE l.id=table_types.location_id AND s.user_id=(SELECT auth.uid()) AND s.is_active AND (s.location_id=l.id OR (s.location_id IS NULL AND s.role IN ('owner','manager'))) AND s.role IN ('owner','manager'))) WITH CHECK (EXISTS(SELECT 1 FROM staff s JOIN locations l ON l.organization_id=s.organization_id WHERE l.id=table_types.location_id AND s.user_id=(SELECT auth.uid()) AND s.is_active AND (s.location_id=l.id OR (s.location_id IS NULL AND s.role IN ('owner','manager'))) AND s.role IN ('owner','manager')));

ALTER TABLE "modifier_options" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "modifier_options_read" ON "modifier_options" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=modifier_options.organization_id AND s.is_active));

CREATE POLICY "modifier_options_manage" ON "modifier_options" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=modifier_options.organization_id AND s.is_active AND s.role IN ('owner','manager'))) WITH CHECK (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=modifier_options.organization_id AND s.is_active AND s.role IN ('owner','manager')));

ALTER TABLE "dish_modifier_groups" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dish_modifier_groups_read" ON "dish_modifier_groups" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=dish_modifier_groups.organization_id AND s.is_active));

CREATE POLICY "dish_modifier_groups_manage" ON "dish_modifier_groups" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=dish_modifier_groups.organization_id AND s.is_active AND s.role IN ('owner','manager'))) WITH CHECK (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=dish_modifier_groups.organization_id AND s.is_active AND s.role IN ('owner','manager')));

ALTER TABLE "account_folio_counters" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_folio_counters_read" ON "account_folio_counters" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=account_folio_counters.organization_id AND s.is_active AND (s.location_id=account_folio_counters.location_id OR (s.location_id IS NULL AND s.role IN ('owner','manager')))));

ALTER TABLE "dining_tables" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_write" ON "dining_tables" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS (SELECT 1 FROM "staff" s JOIN "locations" l ON l.organization_id = s.organization_id JOIN "sections" sec ON sec.location_id = l.id WHERE s.user_id = auth.uid() AND sec.id = "dining_tables"."section_id" AND s.is_active)) WITH CHECK (EXISTS (SELECT 1 FROM "staff" s JOIN "locations" l ON l.organization_id = s.organization_id JOIN "sections" sec ON sec.location_id = l.id WHERE s.user_id = auth.uid() AND sec.id = "dining_tables"."section_id" AND s.is_active));

ALTER TABLE "preparation_stations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_write" ON "preparation_stations" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" IN (SELECT "organization_id" FROM "locations" WHERE "locations"."id" = "preparation_stations"."location_id") AND "staff"."is_active")) WITH CHECK (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" IN (SELECT "organization_id" FROM "locations" WHERE "locations"."id" = "preparation_stations"."location_id") AND "staff"."is_active"));

ALTER TABLE "buffet_menu_dishes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_write" ON "buffet_menu_dishes" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" IN (SELECT "organization_id" FROM "locations" JOIN "buffet_menus" ON "buffet_menus"."location_id" = "locations"."id" WHERE "buffet_menus"."id" = "buffet_menu_dishes"."buffet_menu_id") AND "staff"."is_active")) WITH CHECK (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" IN (SELECT "organization_id" FROM "locations" JOIN "buffet_menus" ON "buffet_menus"."location_id" = "locations"."id" WHERE "buffet_menus"."id" = "buffet_menu_dishes"."buffet_menu_id") AND "staff"."is_active"));

ALTER TABLE "modifier_recipe_ingredients" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "modifier_recipe_ingredients_read" ON "modifier_recipe_ingredients" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=modifier_recipe_ingredients.organization_id AND s.is_active));

CREATE POLICY "modifier_recipe_ingredients_manage" ON "modifier_recipe_ingredients" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=modifier_recipe_ingredients.organization_id AND s.is_active AND s.role IN ('owner','manager'))) WITH CHECK (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=modifier_recipe_ingredients.organization_id AND s.is_active AND s.role IN ('owner','manager')));

ALTER TABLE "section_assignments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "section_assignments_read" ON "section_assignments" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=section_assignments.organization_id AND s.is_active AND (s.location_id=section_assignments.location_id OR (s.location_id IS NULL AND s.role IN ('owner','manager')))));

ALTER TABLE "dish_stations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_write" ON "dish_stations" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" IN (SELECT "organization_id" FROM "dishes" WHERE "dishes"."id" = "dish_stations"."dish_id") AND "staff"."is_active")) WITH CHECK (EXISTS (SELECT 1 FROM "staff" WHERE "staff"."user_id" = auth.uid() AND "staff"."organization_id" IN (SELECT "organization_id" FROM "dishes" WHERE "dishes"."id" = "dish_stations"."dish_id") AND "staff"."is_active"));

ALTER TABLE "buffet_diners" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_write" ON "buffet_diners" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS (SELECT 1 FROM "staff" s JOIN "locations" l ON l.organization_id = s.organization_id JOIN "sections" sec ON sec.location_id = l.id JOIN "dining_tables" dt ON dt.section_id = sec.id WHERE s.user_id = auth.uid() AND dt.id = "buffet_diners"."dining_table_id" AND s.is_active)) WITH CHECK (EXISTS (SELECT 1 FROM "staff" s JOIN "locations" l ON l.organization_id = s.organization_id JOIN "sections" sec ON sec.location_id = l.id JOIN "dining_tables" dt ON dt.section_id = sec.id WHERE s.user_id = auth.uid() AND dt.id = "buffet_diners"."dining_table_id" AND s.is_active));

ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounts_read" ON "accounts" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=accounts.organization_id AND s.is_active AND (s.location_id=accounts.location_id OR (s.location_id IS NULL AND s.role IN ('owner','manager')))));

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_write" ON "orders" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS (SELECT 1 FROM "staff" s JOIN "locations" l ON l.organization_id = s.organization_id JOIN "sections" sec ON sec.location_id = l.id JOIN "dining_tables" dt ON dt.section_id = sec.id WHERE s.user_id = auth.uid() AND dt.id = "orders"."dining_table_id" AND s.is_active)) WITH CHECK (EXISTS (SELECT 1 FROM "staff" s JOIN "locations" l ON l.organization_id = s.organization_id JOIN "sections" sec ON sec.location_id = l.id JOIN "dining_tables" dt ON dt.section_id = sec.id WHERE s.user_id = auth.uid() AND dt.id = "orders"."dining_table_id" AND s.is_active));

ALTER TABLE "buffet_servings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_write" ON "buffet_servings" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS (SELECT 1 FROM "staff" s JOIN "locations" l ON l.organization_id = s.organization_id JOIN "sections" sec ON sec.location_id = l.id JOIN "dining_tables" dt ON dt.section_id = sec.id WHERE s.user_id = auth.uid() AND dt.id = "buffet_servings"."dining_table_id" AND s.is_active)) WITH CHECK (EXISTS (SELECT 1 FROM "staff" s JOIN "locations" l ON l.organization_id = s.organization_id JOIN "sections" sec ON sec.location_id = l.id JOIN "dining_tables" dt ON dt.section_id = sec.id WHERE s.user_id = auth.uid() AND dt.id = "buffet_servings"."dining_table_id" AND s.is_active));

ALTER TABLE "account_assignments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_assignments_read" ON "account_assignments" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=account_assignments.organization_id AND s.is_active AND (s.location_id=account_assignments.location_id OR (s.location_id IS NULL AND s.role IN ('owner','manager')))));

ALTER TABLE "guest_sessions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "guest_order_submissions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guest_order_submissions_read" ON "guest_order_submissions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=guest_order_submissions.organization_id AND s.is_active AND (s.location_id=guest_order_submissions.location_id OR (s.location_id IS NULL AND s.role IN ('owner','manager')))));

ALTER TABLE "service_requests" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_requests_read" ON "service_requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=service_requests.organization_id AND s.is_active AND (s.location_id=service_requests.location_id OR (s.location_id IS NULL AND s.role IN ('owner','manager')))));

ALTER TABLE "guest_order_items" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guest_order_items_read" ON "guest_order_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=guest_order_items.organization_id AND s.is_active AND (s.location_id=guest_order_items.location_id OR (s.location_id IS NULL AND s.role IN ('owner','manager')))));

ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_write" ON "order_items" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS (SELECT 1 FROM "staff" s JOIN "locations" l ON l.organization_id = s.organization_id JOIN "sections" sec ON sec.location_id = l.id JOIN "dining_tables" dt ON dt.section_id = sec.id JOIN "orders" o ON o.dining_table_id = dt.id WHERE s.user_id = auth.uid() AND o.id = "order_items"."order_id" AND s.is_active)) WITH CHECK (EXISTS (SELECT 1 FROM "staff" s JOIN "locations" l ON l.organization_id = s.organization_id JOIN "sections" sec ON sec.location_id = l.id JOIN "dining_tables" dt ON dt.section_id = sec.id JOIN "orders" o ON o.dining_table_id = dt.id WHERE s.user_id = auth.uid() AND o.id = "order_items"."order_id" AND s.is_active));

ALTER TABLE "guest_order_item_modifiers" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guest_order_item_modifiers_read" ON "guest_order_item_modifiers" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=guest_order_item_modifiers.organization_id AND s.is_active AND (s.location_id=guest_order_item_modifiers.location_id OR (s.location_id IS NULL AND s.role IN ('owner','manager')))));

ALTER TABLE "order_item_preparations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_write" ON "order_item_preparations" AS PERMISSIVE FOR ALL TO "authenticated" USING (EXISTS (SELECT 1 FROM "staff" s JOIN "locations" l ON l.organization_id = s.organization_id JOIN "sections" sec ON sec.location_id = l.id JOIN "dining_tables" dt ON dt.section_id = sec.id JOIN "orders" o ON o.dining_table_id = dt.id JOIN "order_items" oi ON oi.order_id = o.id WHERE s.user_id = auth.uid() AND oi.id = "order_item_preparations"."order_item_id" AND s.is_active)) WITH CHECK (EXISTS (SELECT 1 FROM "staff" s JOIN "locations" l ON l.organization_id = s.organization_id JOIN "sections" sec ON sec.location_id = l.id JOIN "dining_tables" dt ON dt.section_id = sec.id JOIN "orders" o ON o.dining_table_id = dt.id JOIN "order_items" oi ON oi.order_id = o.id WHERE s.user_id = auth.uid() AND oi.id = "order_item_preparations"."order_item_id" AND s.is_active));

ALTER TABLE "order_item_modifiers" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_item_modifiers_read" ON "order_item_modifiers" AS PERMISSIVE FOR SELECT TO "authenticated" USING (EXISTS(SELECT 1 FROM staff s WHERE s.user_id=(SELECT auth.uid()) AND s.organization_id=order_item_modifiers.organization_id AND s.is_active));

REVOKE ALL ON inventory_items, recipe_ingredients, inventory_balances, inventory_movements FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_items, recipe_ingredients TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON inventory_balances TO authenticated, service_role;

GRANT SELECT, INSERT ON inventory_movements TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION consume_recipe(uuid,uuid,numeric,uuid), transfer_inventory(uuid,uuid,uuid,numeric,uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION consume_recipe(uuid,uuid,numeric,uuid), transfer_inventory(uuid,uuid,uuid,numeric,uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION validate_inventory_record(), protect_inventory_balance(), validate_inventory_movement(), apply_inventory_movement() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE inventory_items IS 'Stock catalog. All quantities use the immutable base unit: g, ml or each.';

COMMENT ON TABLE inventory_balances IS 'Current stock per location, maintained only by append-only movements. Negative stock is rejected.';

COMMENT ON TABLE recipe_ingredients IS 'Inventory quantity per one dish portion. Separate from descriptive dish_ingredients.';

COMMENT ON TABLE inventory_movements IS 'Append-only signed stock ledger; corrections are new movements. reference_id groups a preparation or transfer request.';

COMMENT ON FUNCTION consume_recipe(uuid,uuid,numeric,uuid) IS 'Explicitly record preparation of dish portions at a location. Reuse the same reference UUID on retries to prevent duplicate consumption. Uses the recipe current at preparation time. Works for orders or buffet batches; status updates do not consume stock.';

COMMENT ON FUNCTION transfer_inventory(uuid,uuid,uuid,numeric,uuid) IS 'Atomically transfer stock between locations in one organization. Reuse the request reference UUID on retries.';

ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_section_location_scope_fkey" FOREIGN KEY ("section_id","location_id") REFERENCES "sections" ("id","location_id");

ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_type_location_scope_fkey" FOREIGN KEY ("table_type_id","location_id") REFERENCES "table_types" ("id","location_id");

ALTER TABLE "modifier_options" ADD CONSTRAINT "modifier_options_modifier_group_id_org_fkey" FOREIGN KEY ("modifier_group_id","organization_id") REFERENCES "modifier_groups" ("id","organization_id");

ALTER TABLE "dish_modifier_groups" ADD CONSTRAINT "dish_modifier_groups_dish_id_org_fkey" FOREIGN KEY ("dish_id","organization_id") REFERENCES "dishes" ("id","organization_id");

ALTER TABLE "dish_modifier_groups" ADD CONSTRAINT "dish_modifier_groups_modifier_group_id_org_fkey" FOREIGN KEY ("modifier_group_id","organization_id") REFERENCES "modifier_groups" ("id","organization_id");

ALTER TABLE "modifier_recipe_ingredients" ADD CONSTRAINT "modifier_recipe_ingredients_modifier_option_id_org_fkey" FOREIGN KEY ("modifier_option_id","organization_id") REFERENCES "modifier_options" ("id","organization_id");

ALTER TABLE "modifier_recipe_ingredients" ADD CONSTRAINT "modifier_recipe_ingredients_inventory_item_id_org_fkey" FOREIGN KEY ("inventory_item_id","organization_id") REFERENCES "inventory_items" ("id","organization_id");

ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_dish_id_org_fkey" FOREIGN KEY ("dish_id","organization_id") REFERENCES "dishes" ("id","organization_id");

ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_modifier_option_id_org_fkey" FOREIGN KEY ("modifier_option_id","organization_id") REFERENCES "modifier_options" ("id","organization_id");

ALTER TABLE "guest_order_items" ADD CONSTRAINT "guest_order_items_dish_id_org_fkey" FOREIGN KEY ("dish_id","organization_id") REFERENCES "dishes" ("id","organization_id");

ALTER TABLE "guest_order_item_modifiers" ADD CONSTRAINT "guest_order_item_modifiers_modifier_option_id_org_fkey" FOREIGN KEY ("modifier_option_id","organization_id") REFERENCES "modifier_options" ("id","organization_id");

ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_dish_identity_fkey" FOREIGN KEY ("order_item_id","dish_id") REFERENCES "order_items" ("id","dish_id");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_location_org_fkey" FOREIGN KEY ("location_id","organization_id") REFERENCES "locations" ("id","organization_id");

ALTER TABLE "account_folio_counters" ADD CONSTRAINT "account_folio_counters_location_org_fkey" FOREIGN KEY ("location_id","organization_id") REFERENCES "locations" ("id","organization_id");

ALTER TABLE "account_assignments" ADD CONSTRAINT "account_assignments_location_org_fkey" FOREIGN KEY ("location_id","organization_id") REFERENCES "locations" ("id","organization_id");

ALTER TABLE "section_assignments" ADD CONSTRAINT "section_assignments_location_org_fkey" FOREIGN KEY ("location_id","organization_id") REFERENCES "locations" ("id","organization_id");

ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_location_org_fkey" FOREIGN KEY ("location_id","organization_id") REFERENCES "locations" ("id","organization_id");

ALTER TABLE "guest_order_submissions" ADD CONSTRAINT "guest_order_submissions_location_org_fkey" FOREIGN KEY ("location_id","organization_id") REFERENCES "locations" ("id","organization_id");

ALTER TABLE "guest_order_items" ADD CONSTRAINT "guest_order_items_location_org_fkey" FOREIGN KEY ("location_id","organization_id") REFERENCES "locations" ("id","organization_id");

ALTER TABLE "guest_order_item_modifiers" ADD CONSTRAINT "guest_order_item_modifiers_location_org_fkey" FOREIGN KEY ("location_id","organization_id") REFERENCES "locations" ("id","organization_id");

ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_location_org_fkey" FOREIGN KEY ("location_id","organization_id") REFERENCES "locations" ("id","organization_id");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_section_location_fkey" FOREIGN KEY ("section_id","location_id") REFERENCES "sections" ("id","location_id");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_table_section_fkey" FOREIGN KEY ("dining_table_id","section_id") REFERENCES "dining_tables" ("id","section_id");

ALTER TABLE "section_assignments" ADD CONSTRAINT "section_assignments_section_location_fkey" FOREIGN KEY ("section_id","location_id") REFERENCES "sections" ("id","location_id");

ALTER TABLE "account_assignments" ADD CONSTRAINT "account_assignments_account_scope_fkey" FOREIGN KEY ("account_id","organization_id","location_id") REFERENCES "accounts" ("id","organization_id","location_id");

ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_account_scope_fkey" FOREIGN KEY ("account_id","organization_id","location_id") REFERENCES "accounts" ("id","organization_id","location_id");

ALTER TABLE "guest_order_submissions" ADD CONSTRAINT "guest_order_submissions_account_scope_fkey" FOREIGN KEY ("account_id","organization_id","location_id") REFERENCES "accounts" ("id","organization_id","location_id");

ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_account_scope_fkey" FOREIGN KEY ("account_id","organization_id","location_id") REFERENCES "accounts" ("id","organization_id","location_id");

ALTER TABLE "guest_order_submissions" ADD CONSTRAINT "guest_order_submissions_session_account_scope_fkey" FOREIGN KEY ("guest_session_id","account_id","organization_id","location_id") REFERENCES "guest_sessions" ("id","account_id","organization_id","location_id");

ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_session_account_scope_fkey" FOREIGN KEY ("guest_session_id","account_id","organization_id","location_id") REFERENCES "guest_sessions" ("id","account_id","organization_id","location_id");

ALTER TABLE "guest_order_items" ADD CONSTRAINT "guest_order_items_submission_scope_fkey" FOREIGN KEY ("submission_id","organization_id","location_id") REFERENCES "guest_order_submissions" ("id","organization_id","location_id");

ALTER TABLE "guest_order_item_modifiers" ADD CONSTRAINT "guest_order_item_modifiers_item_scope_fkey" FOREIGN KEY ("guest_order_item_id","organization_id","location_id") REFERENCES "guest_order_items" ("id","organization_id","location_id");

ALTER TABLE "orders" ADD CONSTRAINT "orders_account_table_scope_fkey" FOREIGN KEY ("account_id","dining_table_id") REFERENCES "accounts" ("id","dining_table_id");

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_guest_dish_scope_fkey" FOREIGN KEY ("guest_order_item_id","dish_id") REFERENCES "guest_order_items" ("id","dish_id");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_assigned_staff_id_org_fkey" FOREIGN KEY ("assigned_staff_id","organization_id") REFERENCES "staff" ("id","organization_id");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_opened_by_staff_id_org_fkey" FOREIGN KEY ("opened_by_staff_id","organization_id") REFERENCES "staff" ("id","organization_id");

ALTER TABLE "account_assignments" ADD CONSTRAINT "account_assignments_previous_staff_id_org_fkey" FOREIGN KEY ("previous_staff_id","organization_id") REFERENCES "staff" ("id","organization_id");

ALTER TABLE "account_assignments" ADD CONSTRAINT "account_assignments_assigned_staff_id_org_fkey" FOREIGN KEY ("assigned_staff_id","organization_id") REFERENCES "staff" ("id","organization_id");

ALTER TABLE "account_assignments" ADD CONSTRAINT "account_assignments_changed_by_staff_id_org_fkey" FOREIGN KEY ("changed_by_staff_id","organization_id") REFERENCES "staff" ("id","organization_id");

ALTER TABLE "section_assignments" ADD CONSTRAINT "section_assignments_assigned_staff_id_org_fkey" FOREIGN KEY ("assigned_staff_id","organization_id") REFERENCES "staff" ("id","organization_id");

ALTER TABLE "section_assignments" ADD CONSTRAINT "section_assignments_assigned_by_staff_id_org_fkey" FOREIGN KEY ("assigned_by_staff_id","organization_id") REFERENCES "staff" ("id","organization_id");

ALTER TABLE "guest_order_submissions" ADD CONSTRAINT "guest_order_submissions_reviewed_by_staff_id_org_fkey" FOREIGN KEY ("reviewed_by_staff_id","organization_id") REFERENCES "staff" ("id","organization_id");

ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_acknowledged_by_staff_id_org_fkey" FOREIGN KEY ("acknowledged_by_staff_id","organization_id") REFERENCES "staff" ("id","organization_id");

ALTER TABLE "locations" ADD CONSTRAINT "locations_time_zone_nonempty" CHECK (length(btrim(time_zone))>0);

ALTER TABLE "locations" ADD CONSTRAINT "locations_guest_settings_valid" CHECK (guest_order_mode IN ('confirmation','direct') AND max_pending_guest_orders>0);

ALTER TABLE "dishes" ADD CONSTRAINT "dishes_photo_reference_pair" CHECK ((photo_bucket IS NULL AND photo_path IS NULL) OR (photo_bucket IS NOT NULL AND photo_path IS NOT NULL AND length(btrim(photo_bucket))>0 AND length(btrim(photo_path))>0));

ALTER TABLE "sections" ADD CONSTRAINT "sections_canvas_geometry_valid" CHECK (canvas_width>0 AND canvas_width<'Infinity'::numeric AND canvas_height>0 AND canvas_height<'Infinity'::numeric AND canvas_x>'-Infinity'::numeric AND canvas_x<'Infinity'::numeric AND canvas_y>'-Infinity'::numeric AND canvas_y<'Infinity'::numeric AND canvas_rotation>'-Infinity'::numeric AND canvas_rotation<'Infinity'::numeric);

ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_canvas_geometry_valid" CHECK (canvas_width>0 AND canvas_width<'Infinity'::numeric AND canvas_height>0 AND canvas_height<'Infinity'::numeric AND canvas_x>'-Infinity'::numeric AND canvas_x<'Infinity'::numeric AND canvas_y>'-Infinity'::numeric AND canvas_y<'Infinity'::numeric AND canvas_rotation>'-Infinity'::numeric AND canvas_rotation<'Infinity'::numeric);

ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_seat_count_valid" CHECK (seat_count>0);

ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_type_requires_location" CHECK (table_type_id IS NULL OR location_id IS NOT NULL);

ALTER TABLE "table_types" ADD CONSTRAINT "table_types_dimensions_valid" CHECK (seat_count>0 AND width>0 AND width<'Infinity'::numeric AND height>0 AND height<'Infinity'::numeric AND length(btrim(name))>0);

ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_selection_limits" CHECK (min_selections>=0 AND (max_selections IS NULL OR (max_selections>=1 AND max_selections>=min_selections)) AND length(btrim(name))>0);

ALTER TABLE "modifier_options" ADD CONSTRAINT "modifier_options_price_valid" CHECK (price_extra>=0 AND price_extra<'Infinity'::numeric AND length(btrim(name))>0);

ALTER TABLE "modifier_recipe_ingredients" ADD CONSTRAINT "modifier_recipe_quantity_nonzero" CHECK (quantity_delta<>0 AND quantity_delta>'-Infinity'::numeric AND quantity_delta<'Infinity'::numeric);

ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_snapshot_valid" CHECK (quantity>0 AND unit_price_extra>=0 AND unit_price_extra<'Infinity'::numeric AND length(btrim(group_name))>0 AND length(btrim(option_name))>0);

ALTER TABLE "guest_order_item_modifiers" ADD CONSTRAINT "guest_order_item_modifiers_snapshot_valid" CHECK (quantity>0 AND unit_price_extra>=0 AND unit_price_extra<'Infinity'::numeric AND length(btrim(group_name))>0 AND length(btrim(option_name))>0);

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_kind_table_valid" CHECK ((kind='dine_in' AND dining_table_id IS NOT NULL AND section_id IS NOT NULL) OR (kind<>'dine_in' AND dining_table_id IS NULL AND section_id IS NULL));

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_numbers_valid" CHECK (version>0 AND (folio IS NULL OR folio>0) AND total_amount>=0 AND total_amount<'Infinity'::numeric);

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_phone_consent_required" CHECK (customer_phone IS NULL OR (phone_consent_at IS NOT NULL AND privacy_notice_version IS NOT NULL AND length(btrim(privacy_notice_version))>0));

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_closed_timestamp_required" CHECK (state<>'closed' OR closed_at IS NOT NULL);

ALTER TABLE "account_folio_counters" ADD CONSTRAINT "account_folio_counter_positive" CHECK (next_folio>0 AND version>0);

ALTER TABLE "section_assignments" ADD CONSTRAINT "section_assignments_time_range" CHECK (ends_at IS NULL OR ends_at>starts_at);

ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_access_expiry_valid" CHECK (expires_at>created_at);

ALTER TABLE "guest_order_submissions" ADD CONSTRAINT "guest_submissions_review_valid" CHECK (version>0 AND (state='pending' OR (reviewed_at IS NOT NULL AND reviewed_by_staff_id IS NOT NULL)) AND (state<>'rejected' OR (rejection_reason IS NOT NULL AND length(btrim(rejection_reason))>0)));

ALTER TABLE "guest_order_items" ADD CONSTRAINT "guest_order_items_values_valid" CHECK (quantity>0 AND unit_price>=0 AND unit_price<'Infinity'::numeric AND length(btrim(dish_name))>0);

REVOKE ALL ON "table_types" FROM PUBLIC, anon, authenticated;

GRANT ALL ON "table_types" TO service_role;

GRANT SELECT ON "table_types" TO authenticated;

GRANT INSERT,UPDATE,DELETE ON "table_types" TO authenticated;

REVOKE ALL ON "modifier_groups" FROM PUBLIC, anon, authenticated;

GRANT ALL ON "modifier_groups" TO service_role;

GRANT SELECT ON "modifier_groups" TO authenticated;

GRANT INSERT,UPDATE,DELETE ON "modifier_groups" TO authenticated;

REVOKE ALL ON "modifier_options" FROM PUBLIC, anon, authenticated;

GRANT ALL ON "modifier_options" TO service_role;

GRANT SELECT ON "modifier_options" TO authenticated;

GRANT INSERT,UPDATE,DELETE ON "modifier_options" TO authenticated;

REVOKE ALL ON "dish_modifier_groups" FROM PUBLIC, anon, authenticated;

GRANT ALL ON "dish_modifier_groups" TO service_role;

GRANT SELECT ON "dish_modifier_groups" TO authenticated;

GRANT INSERT,UPDATE,DELETE ON "dish_modifier_groups" TO authenticated;

REVOKE ALL ON "modifier_recipe_ingredients" FROM PUBLIC, anon, authenticated;

GRANT ALL ON "modifier_recipe_ingredients" TO service_role;

GRANT SELECT ON "modifier_recipe_ingredients" TO authenticated;

GRANT INSERT,UPDATE,DELETE ON "modifier_recipe_ingredients" TO authenticated;

REVOKE ALL ON "order_item_modifiers" FROM PUBLIC, anon, authenticated;

GRANT ALL ON "order_item_modifiers" TO service_role;

GRANT SELECT ON "order_item_modifiers" TO authenticated;

REVOKE ALL ON "accounts" FROM PUBLIC, anon, authenticated;

GRANT ALL ON "accounts" TO service_role;

GRANT SELECT ON "accounts" TO authenticated;

REVOKE ALL ON "account_folio_counters" FROM PUBLIC, anon, authenticated;

GRANT ALL ON "account_folio_counters" TO service_role;

GRANT SELECT ON "account_folio_counters" TO authenticated;

REVOKE ALL ON "account_assignments" FROM PUBLIC, anon, authenticated;

GRANT ALL ON "account_assignments" TO service_role;

GRANT SELECT ON "account_assignments" TO authenticated;

REVOKE ALL ON "section_assignments" FROM PUBLIC, anon, authenticated;

GRANT ALL ON "section_assignments" TO service_role;

GRANT SELECT ON "section_assignments" TO authenticated;

REVOKE ALL ON "guest_sessions" FROM PUBLIC, anon, authenticated;

GRANT ALL ON "guest_sessions" TO service_role;

REVOKE ALL ON "guest_order_submissions" FROM PUBLIC, anon, authenticated;

GRANT ALL ON "guest_order_submissions" TO service_role;

GRANT SELECT ON "guest_order_submissions" TO authenticated;

REVOKE ALL ON "guest_order_items" FROM PUBLIC, anon, authenticated;

GRANT ALL ON "guest_order_items" TO service_role;

GRANT SELECT ON "guest_order_items" TO authenticated;

REVOKE ALL ON "guest_order_item_modifiers" FROM PUBLIC, anon, authenticated;

GRANT ALL ON "guest_order_item_modifiers" TO service_role;

GRANT SELECT ON "guest_order_item_modifiers" TO authenticated;

REVOKE ALL ON "service_requests" FROM PUBLIC, anon, authenticated;

GRANT ALL ON "service_requests" TO service_role;

GRANT SELECT ON "service_requests" TO authenticated;

COMMENT ON TABLE table_types IS 'Reusable restaurant-specific table presets: shape, chair count and default dimensions. The app copies the preset to each table instance.';

COMMENT ON TABLE accounts IS 'Financial service session grouped separately from existing preparation orders. Lifecycle, totals and concurrency are handled in application code.';

COMMENT ON TABLE account_assignments IS 'Assignment history recorded by backend code; no automatic history trigger is installed.';

COMMENT ON TABLE section_assignments IS 'Time-bounded waiter/zone assignments. Backend code manages overlaps and reassignment.';

COMMENT ON TABLE guest_order_items IS 'Pending QR order lines, separate from live order_items so drafts do not invoke existing kitchen triggers.';

COMMENT ON TABLE guest_order_item_modifiers IS 'Modifier name and price snapshots for pending guest lines.';

COMMENT ON TABLE order_item_modifiers IS 'Modifier snapshots for accepted order lines. Application includes extras in totals and consumption.';

COMMENT ON TABLE service_requests IS 'Persistent waiter-call, bill and collection requests. Delivery and acknowledgement are application workflows.';

CREATE UNIQUE INDEX accounts_one_open_table_uidx ON accounts(dining_table_id) WHERE state IN ('open','awaiting_payment');

COMMENT ON TABLE guest_sessions IS 'Guest-to-bill access bindings. Supabase Auth manages identity and login sessions; this table stores user UUID, nickname and bill-access expiry/revocation.';

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE TABLE private.organization_codes (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
 code text NOT NULL UNIQUE
);
REVOKE ALL ON private.organization_codes FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.complete_onboarding(p_name text, p_kind text, p_organization text, p_code text, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := auth.uid(); v_org uuid; v_location uuid; v_code text;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
 IF EXISTS (SELECT 1 FROM public.staff WHERE user_id = v_user) THEN RETURN; END IF;
 IF length(trim(coalesce(p_name,''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid name'; END IF;
 IF p_kind = 'owner' THEN
  IF length(trim(coalesce(p_organization,''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid organization name'; END IF;
  INSERT INTO public.organizations(name) VALUES (trim(p_organization)) RETURNING id INTO v_org;
  INSERT INTO public.locations(organization_id, name, restrict_waiters_to_assigned_tables) VALUES (v_org, trim(p_organization), false) RETURNING id INTO v_location;
  v_code := upper(encode(extensions.gen_random_bytes(12), 'hex'));
  INSERT INTO private.organization_codes(organization_id, code) VALUES (v_org, v_code);
  INSERT INTO public.staff(organization_id, location_id, user_id, role, display_name, is_active, created_at) VALUES (v_org, NULL, v_user, 'owner', trim(p_name), true, now());
 ELSIF p_kind = 'employee' THEN
  IF p_role NOT IN ('chef','barista','bartender','waiter','cashier') OR p_role IS NULL THEN RAISE EXCEPTION 'Invalid role'; END IF;
  SELECT organization_id INTO v_org FROM private.organization_codes WHERE code = upper(trim(coalesce(p_code,'')));
  IF v_org IS NULL THEN RAISE EXCEPTION 'Invalid organization code'; END IF;
  SELECT id INTO v_location FROM public.locations WHERE organization_id = v_org ORDER BY created_at, id LIMIT 1;
  IF v_location IS NULL THEN RAISE EXCEPTION 'Organization has no location'; END IF;
  INSERT INTO public.staff(organization_id, location_id, user_id, role, display_name, is_active, created_at) VALUES (v_org, v_location, v_user, p_role::public.staff_role, trim(p_name), true, now());
 ELSE RAISE EXCEPTION 'Invalid account type'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.complete_onboarding(text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.complete_onboarding(text,text,text,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.complete_onboarding(p_name text, p_kind text, p_organization text DEFAULT NULL, p_code text DEFAULT NULL, p_role text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT private.complete_onboarding(p_name,p_kind,p_organization,p_code,p_role); $$;
REVOKE ALL ON FUNCTION public.complete_onboarding(text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(text,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.my_organization_code()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
 SELECT c.code FROM private.organization_codes c JOIN public.staff s ON s.organization_id = c.organization_id WHERE s.user_id = auth.uid() AND s.is_active AND s.role = 'owner' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.my_organization_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.my_organization_code() TO authenticated;
CREATE OR REPLACE FUNCTION public.my_organization_code()
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT private.my_organization_code(); $$;
REVOKE ALL ON FUNCTION public.my_organization_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_organization_code() TO authenticated;
