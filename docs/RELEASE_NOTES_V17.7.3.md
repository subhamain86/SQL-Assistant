# Release notes — V17.7.3

V17.7.3 introduces optional Usage Analytics for measuring SQL Assistant adoption and utilization. The Analytics dashboard is available from the hamburger menu and protected by centralized administrator authentication. Analytics capture usage metadata only and do not capture SQL content, credentials, database results, or customer data.

* A new menu entry **Analytics** (hamburger menu, between *Error Rectifier* and *Settings*, with a lock icon) asks for the Analytics administrator password; without it nothing is shown.
* The dashboard shows 11 KPI cards, daily / weekly / monthly utilization, the usage trend, the most-used features, the application versions and a date-range filter; *Lock Analytics* and an inactivity timeout lock it; a reload requires the password again.
* The password is checked by the analytics service (`server/analytics-service.mjs`, a salted scrypt hash) and can be rotated without rebuilding SQL Assistant. Analytics is off unless `sql-assistant-data/analytics.config.json` is deployed.
* See `docs/ANALYTICS.md`.
