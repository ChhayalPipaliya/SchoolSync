ALTER TABLE transport_trips
  ADD COLUMN running_driver_guard INT UNSIGNED
  GENERATED ALWAYS AS (CASE WHEN status = 'running' THEN driver_id ELSE NULL END) STORED;

ALTER TABLE transport_trips
  ADD COLUMN running_vehicle_guard INT UNSIGNED
  GENERATED ALWAYS AS (CASE WHEN status = 'running' THEN vehicle_id ELSE NULL END) STORED;

ALTER TABLE transport_trips
  ADD UNIQUE KEY uq_transport_running_driver (school_id, running_driver_guard);

ALTER TABLE transport_trips
  ADD UNIQUE KEY uq_transport_running_vehicle (school_id, running_vehicle_guard);
