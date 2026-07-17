import { test, expect, type APIRequestContext } from '@playwright/test';

const API_BASE = 'http://localhost:4000/api/v1';

/** Logs in via the API (fast, reliable) and returns the CSRF token for subsequent calls. */
async function apiLogin(request: APIRequestContext, username: string, password: string, totp?: string): Promise<string> {
  const res = await request.post(`${API_BASE}/auth/login`, { data: { username, password, totp } });
  expect(res.ok()).toBeTruthy();
  const cookies = (await request.storageState()).cookies;
  const csrf = cookies.find((c) => c.name === 'cdc_csrf')?.value;
  if (!csrf) throw new Error('cdc_csrf cookie not set after login');
  return csrf;
}

test.describe('Critical path: login → acknowledge a CRITICAL alert → generate a report', () => {
  test('operator can sign in, ack a critical alert with a note, and a supervisor can generate + view a report', async ({
    page,
    request,
  }) => {
    // Arrange: force a real CRITICAL alert to exist via the scripted scenario endpoint, exactly
    // as a real crowd surge would, so the UI has something real to acknowledge.
    const supervisorCsrf = await apiLogin(request, 'supervisor', 'super123', '000000');

    // Pre-clear any pre-existing OPEN alerts in our target zone before triggering the storm below.
    // Without this, ambient/organic alerts (which fire realistically now — see ARCHITECTURE.md's
    // diurnal/surge notes) can independently accumulate in the zone and push its *total* open-alert
    // count to the storm-grouping threshold (6 — see features/alerts/dedup.ts) even though our own
    // deliberately-small storm below never would alone. When that happens mid-test, the individual
    // camera's card this test depends on gets replaced by an anonymous zone-wide StormCard between
    // the note-fill and the Acknowledge click, and Playwright's locator (scoped to the camera's
    // name, which a StormCard doesn't render) never resolves again — a real, reproduced failure
    // even against a freshly-started server, not just test flakiness to paper over with a timeout.
    const preExisting = await request.get(`${API_BASE}/alerts?status=OPEN&zoneId=zone-industrial`);
    const preExistingBody = await preExisting.json();
    for (const a of preExistingBody.items as Array<{ id: string }>) {
      await request.post(`${API_BASE}/alerts/${a.id}/resolve`, { headers: { 'X-CDC-CSRF': supervisorCsrf } });
    }

    // Deliberately under the storm-grouping threshold (6 — see features/alerts/dedup.ts) so the
    // alerts render as individual acknowledgeable cards rather than collapsing into one storm
    // card, keeping this test about the single-alert ack flow specifically. Targets
    // zone-industrial specifically — the fleet's lowest-traffic, lowest-surge-chance zone (see
    // server/src/sim/metrics.ts's ZONE_PROFILES) — combined with the pre-clear above, so
    // ambient/organic alerts don't independently push this zone's total alert count over the storm
    // threshold and collapse our target camera into a storm card instead of the individually-
    // ackable card this test needs.
    const storm = await request.post(`${API_BASE}/_dev/scenarios/alert-storm`, {
      headers: { 'X-CDC-CSRF': supervisorCsrf },
      data: { zoneId: 'zone-industrial', count: 3 },
    });
    expect(storm.ok()).toBeTruthy();

    // Sustained-breach hysteresis (12s) needs to elapse against real simulation ticks before an
    // alert actually raises — poll the API rather than a blind sleep.
    await expect
      .poll(
        async () => {
          const res = await request.get(`${API_BASE}/alerts?severity=CRITICAL&status=OPEN&zoneId=zone-industrial`);
          const body = await res.json();
          return body.items.length as number;
        },
        { timeout: 45_000, message: 'waiting for the alert storm to raise at least one CRITICAL alert' },
      )
      .toBeGreaterThan(0);

    // Resolve a stable target camera name via the API up front, rather than grabbing ".first()"
    // of whatever's on top of the tray in the UI — with the ambient simulation now realistically
    // raising and re-sorting alerts continuously (most-recent-first), a locator re-evaluated
    // between the note-fill and the Acknowledge click could resolve to a *different* card than the
    // one just filled in. Targeting one known camera name throughout stays correct regardless of
    // how many unrelated alerts arrive and reorder the list around it.
    const targetAlertRes = await request.get(`${API_BASE}/alerts?severity=CRITICAL&status=OPEN&zoneId=zone-industrial`);
    const targetAlertBody = await targetAlertRes.json();
    const targetCameraId = targetAlertBody.items[0].cameraId as string;
    const targetCameraRes = await request.get(`${API_BASE}/cameras/${targetCameraId}`);
    const ackedCameraName = (await targetCameraRes.json()).name as string;

    // Act: sign in through the real UI as an operator.
    await page.goto('/');
    await page.getByLabel('Username').fill('operator');
    await page.getByLabel('Password').fill('operator123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Control Center')).toBeVisible({ timeout: 15_000 });

    // Open the alert tray and acknowledge our target camera's CRITICAL alert with a mandatory note.
    await page.getByRole('button', { name: 'Expand alert tray' }).click();
    const openAlerts = page.getByRole('region', { name: 'Open alerts' });
    // Use `hasText` (a plain substring match relative to the candidate), not `has` with a locator
    // built off `openAlerts` — chaining a region-scoped locator into `has` embeds that region's own
    // selector as a required *descendant* match, which an <li> can never satisfy (the region is an
    // ancestor, not nested inside it), and the query hangs until the test timeout instead of erroring.
    const criticalCard = openAlerts.locator('li').filter({ hasText: ackedCameraName }).first();
    await expect(criticalCard).toBeVisible({ timeout: 15_000 });
    await criticalCard.getByPlaceholder(/describe your response/i).fill('Deploying additional units to the area.');
    await criticalCard.getByRole('button', { name: 'Acknowledge' }).click();

    // Acknowledging removes the alert from the OPEN list — the specific card for this camera
    // disappearing from the tray is the observable proof the ack round-tripped for real (scoped
    // to the tray region — the same camera name also appears in the sidebar, which must stay
    // unaffected). useAckAlert patches the cache directly from the ack response rather than
    // relying solely on a background invalidateQueries refetch, specifically so this stays
    // near-instant even when the ambient simulation is raising other alerts continuously and
    // firing its own invalidations at the same time (a real out-of-order-refetch race this test
    // caught: see useAckAlert's patchAlertInCache in features/alerts/api.ts).
    await expect(openAlerts.getByRole('button', { name: ackedCameraName, exact: true })).toHaveCount(0, { timeout: 10_000 });

    // Sign out and back in as a supervisor to generate a report (OPERATOR can already generate
    // reports too, but exercising the role switch keeps this path honest end-to-end).
    await page.getByTitle('Sign out').click();
    await page.getByLabel('Username').fill('supervisor');
    await page.getByLabel('Password').fill('super123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByLabel('Authenticator code').fill('000000');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Control Center')).toBeVisible({ timeout: 15_000 });

    await page.getByTitle('Reports').click();
    // exact: true — the dialog also lists per-camera buttons named "Godavari Bund Road & Pushkar
    // Ghat 10", etc., which a non-exact name match would ambiguously catch too.
    await page.getByRole('dialog').getByRole('button', { name: 'Godavari Bund Road & Pushkar Ghat', exact: true }).click();
    await page.getByRole('button', { name: 'Generate report' }).click();

    await page.getByRole('button', { name: 'My reports' }).click();
    await expect(page.getByText(/^RPT-/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Done').first()).toBeVisible({ timeout: 20_000 });

    // The report viewer auto-opens on generation; confirm real camera rows rendered.
    await expect(page.getByRole('columnheader', { name: 'Peak' })).toBeVisible();
  });
});
