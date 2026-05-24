DELETE FROM `deployment_envelope_surfaces`
WHERE `surface_kind` = 'operation'
  AND `action` = 'read'
  AND EXISTS (
    SELECT 1
    FROM `deployment_envelope_surfaces` AS `target`
    WHERE `target`.`deployment_id` = `deployment_envelope_surfaces`.`deployment_id`
      AND `target`.`contract_id` = `deployment_envelope_surfaces`.`contract_id`
      AND `target`.`surface_kind` = `deployment_envelope_surfaces`.`surface_kind`
      AND `target`.`surface_name` = `deployment_envelope_surfaces`.`surface_name`
      AND `target`.`action` = 'observe'
  );
--> statement-breakpoint
UPDATE `deployment_envelope_surfaces`
SET `action` = 'observe'
WHERE `surface_kind` = 'operation'
  AND `action` = 'read';
--> statement-breakpoint
DELETE FROM `deployment_envelope_surfaces`
WHERE `surface_kind` = 'feed'
  AND `action` = 'read'
  AND EXISTS (
    SELECT 1
    FROM `deployment_envelope_surfaces` AS `target`
    WHERE `target`.`deployment_id` = `deployment_envelope_surfaces`.`deployment_id`
      AND `target`.`contract_id` = `deployment_envelope_surfaces`.`contract_id`
      AND `target`.`surface_kind` = `deployment_envelope_surfaces`.`surface_kind`
      AND `target`.`surface_name` = `deployment_envelope_surfaces`.`surface_name`
      AND `target`.`action` = 'subscribe'
  );
--> statement-breakpoint
UPDATE `deployment_envelope_surfaces`
SET `action` = 'subscribe'
WHERE `surface_kind` = 'feed'
  AND `action` = 'read';
--> statement-breakpoint
DELETE FROM `envelope_expansion_request_surfaces`
WHERE `surface_kind` = 'operation'
  AND `action` = 'read'
  AND EXISTS (
    SELECT 1
    FROM `envelope_expansion_request_surfaces` AS `target`
    WHERE `target`.`request_id` = `envelope_expansion_request_surfaces`.`request_id`
      AND `target`.`contract_id` = `envelope_expansion_request_surfaces`.`contract_id`
      AND `target`.`surface_kind` = `envelope_expansion_request_surfaces`.`surface_kind`
      AND `target`.`surface_name` = `envelope_expansion_request_surfaces`.`surface_name`
      AND `target`.`action` = 'observe'
  );
--> statement-breakpoint
UPDATE `envelope_expansion_request_surfaces`
SET `action` = 'observe'
WHERE `surface_kind` = 'operation'
  AND `action` = 'read';
--> statement-breakpoint
DELETE FROM `envelope_expansion_request_surfaces`
WHERE `surface_kind` = 'feed'
  AND `action` = 'read'
  AND EXISTS (
    SELECT 1
    FROM `envelope_expansion_request_surfaces` AS `target`
    WHERE `target`.`request_id` = `envelope_expansion_request_surfaces`.`request_id`
      AND `target`.`contract_id` = `envelope_expansion_request_surfaces`.`contract_id`
      AND `target`.`surface_kind` = `envelope_expansion_request_surfaces`.`surface_kind`
      AND `target`.`surface_name` = `envelope_expansion_request_surfaces`.`surface_name`
      AND `target`.`action` = 'subscribe'
  );
--> statement-breakpoint
UPDATE `envelope_expansion_request_surfaces`
SET `action` = 'subscribe'
WHERE `surface_kind` = 'feed'
  AND `action` = 'read';
--> statement-breakpoint
UPDATE `contracts`
SET `analysis` = replace(`analysis`, '"readCapabilities"', '"observeCapabilities"')
WHERE `analysis` LIKE '%"readCapabilities"%';
