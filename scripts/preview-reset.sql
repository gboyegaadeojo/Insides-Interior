-- Clears test records from the PREVIEW database before each CI preview run.
-- D1's free daily read allowance is per account, shared with production; a
-- preview database that grows with every run used it up on 2026-10-30.
-- Keeps the business, users, settings, tax rates and numbering (seed.ts adds
-- anything missing). Never run this against production.
DELETE FROM change_request;
DELETE FROM message;
DELETE FROM conversation;
DELETE FROM portal_event;
DELETE FROM notification;
DELETE FROM push_subscription;
DELETE FROM email_message;
DELETE FROM activity;
DELETE FROM client_credit;
DELETE FROM payment;
DELETE FROM invoice_line_tax;
DELETE FROM invoice_line;
DELETE FROM invoice_revision;
DELETE FROM invoice;
DELETE FROM quote_acceptance;
DELETE FROM quote_revision;
DELETE FROM quote;
DELETE FROM expense;
DELETE FROM project;
DELETE FROM site;
DELETE FROM client_contact;
DELETE FROM client;
DELETE FROM room_template_line;
DELETE FROM room_template;
DELETE FROM item;
DELETE FROM session WHERE expires_at < unixepoch('now') * 1000;
DELETE FROM verification;
