import React from "react";
import { Box, Button, Divider, FormControlLabel, Stack, Switch, TextField, Typography } from "@mui/material";
import { BellRing, Save } from "lucide-react";
import { ALERT_INDEXES, alertLotThreshold } from "../alertThresholds";
import { GlassCard, PageHeader, PageShell } from "../ui/Glass";

export default function Settings({ settings = {}, handleSettingsSave, handleSettingsChange }) {
  const alertsEnabled = Boolean(settings.alertsEnabled);
  const save = async event => { event.preventDefault(); await handleSettingsSave(); };
  return <PageShell maxWidth={860}>
    <PageHeader title="Settings" subtitle="Choose when Utraders alerts you about big moves in the futures order book." />
    <GlassCard padding={{ xs: 2.5, sm: 3.5 }} component="form" id="settings-form" onSubmit={save}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
        <Box sx={{ width: 40, height: 40, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "rgba(74,111,224,0.12)", color: "primary.main" }}>
          <BellRing size={20} />
        </Box>
        <Box>
          <Typography variant="h2">Swing alerts</Typography>
          <Typography variant="body2" color="text.secondary">A sound plays and the swing is highlighted in Swing alerts.</Typography>
        </Box>
      </Stack>

      <FormControlLabel control={<Switch name="alertsEnabled" checked={alertsEnabled} onChange={handleSettingsChange} />}
        label={<Typography fontWeight={700}>Enable alerts</Typography>} />

      <Divider sx={{ my: 2.5 }} />
      <Typography component="legend" variant="subtitle1" sx={{ mb: 1.5 }}>Alert swing lots</Typography>
      <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" } }}>
        {ALERT_INDEXES.map(([key, label]) => <TextField key={key} id={`alert-lot-threshold-${key}`} label={label} type="number"
          name={`alertLotThresholds.${key}`} inputProps={{ min: 1, step: 1 }}
          value={settings.alertLotThresholds?.[key] ?? alertLotThreshold(settings, key)} onChange={handleSettingsChange} />)}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
        Swing alerts trigger when net lots move by at least this many lots in five minutes. SENSEX trades far fewer lots, so it needs a smaller number. AC/DD alerts trigger on option volume surges above 250%.
      </Typography>

      <Divider sx={{ my: 2.5 }} />
      <TextField id="alert-email" type="email" name="alertEmail" label="Alert email" placeholder="Optional email for alert delivery"
        value={settings.alertEmail || ""} onChange={handleSettingsChange} fullWidth
        helperText="Email is optional. Without email, alerts still play a sound and show in Swing alerts." />

      <Stack direction="row" justifyContent="flex-end" sx={{ mt: 3 }}>
        <Button type="submit" variant="contained" startIcon={<Save size={17} />} size="large">Save settings</Button>
      </Stack>
    </GlassCard>
  </PageShell>;
}
