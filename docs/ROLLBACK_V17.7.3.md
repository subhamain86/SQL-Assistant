# Rollback — V17.7.3 → V17.7.2

Deploy `SQL-Assistant-V17.7.2.zip` (the last good package) in place of V17.7.3. V17.7.3 adds two browser keys, `sqla.analytics.uid.v1773` and `sqla.analytics.queue.v1773`, written only when analytics is enabled; V17.7.2 ignores them. The analytics service is separate: after a rollback nothing is sent and it can keep running or be stopped. The administrator password exists only as a hash inside the service.
