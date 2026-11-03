import React, { useState } from "react";
import { Box, Button, Fade, InputAdornment, Paper, Stack, TextField, Typography } from "@mui/material";
import { ArrowRight, BellRing, ChartCandlestick, LayoutDashboard, LockKeyhole, UserRound } from "lucide-react";
import brandMark from "../assets/brand/utraders-mark.png";
import logo from "../assets/brand/utraders-logo-dark.png";
import logoOnDark from "../assets/brand/utraders-logo-light.png";
import { useTheme } from "../theme";

const FEATURES = [
  [LayoutDashboard, "Live index futures", "NIFTY, BANKNIFTY and SENSEX across all three expiries."],
  [ChartCandlestick, "Stock F&O watchlists", "Futures and options with depth and five-minute charts."],
  [BellRing, "Lot-swing alerts", "A sound and a highlighted alert when net lots move."],
];

export default function LoginForm({ handleLogin }) {
  const [form, setForm] = useState({ username: "", password: "" });
  const { theme } = useTheme();
  const change = event => setForm(previous => ({ ...previous, [event.target.name]: event.target.value }));
  const submit = event => { event.preventDefault(); handleLogin(form); };

  return <Box component="main" sx={{ minHeight: "100vh", display: "grid", placeItems: "center", px: 2, py: 4 }}>
    <Fade in appear timeout={320}>
      <Paper component="section" aria-label="Ticker login" sx={{ width: "100%", maxWidth: 960, display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.05fr 0.95fr" }, overflow: "hidden", borderRadius: 6 }}>
        <Box sx={{ p: { xs: 3, sm: 5 } }}>
          <Box component="img" src={theme === "dark" ? logoOnDark : logo} alt="Utraders" sx={{ height: 56, mb: 4 }} />
          <Typography variant="h1" component="h1" sx={{ mb: 1 }}>Sign in to Utraders Ticker</Typography>
          <Typography color="text.secondary" sx={{ mb: 4 }}>Use the username and password from your administrator.</Typography>
          <Stack component="form" id="login-form" spacing={2.25} onSubmit={submit}>
            <TextField required autoFocus label="Username" name="username" id="username-input" placeholder="Enter username"
              autoComplete="username" value={form.username} onChange={change} fullWidth
              InputProps={{ startAdornment: <InputAdornment position="start"><UserRound size={18} /></InputAdornment> }} />
            <TextField required type="password" label="Password" name="password" id="password-input" placeholder="Enter password"
              autoComplete="current-password" value={form.password} onChange={change} fullWidth
              InputProps={{ startAdornment: <InputAdornment position="start"><LockKeyhole size={18} /></InputAdornment> }} />
            <Button type="submit" variant="contained" size="large" endIcon={<ArrowRight size={18} />} sx={{ height: 50, fontSize: "1rem" }}>
              Sign in
            </Button>
          </Stack>
        </Box>

        <Box aria-hidden="true" sx={{
          display: { xs: "none", md: "flex" }, flexDirection: "column", justifyContent: "center", gap: 3, p: 5, position: "relative",
          background: "linear-gradient(160deg, rgba(43,179,173,0.16), rgba(91,110,225,0.20))",
        }}>
          <Box component="img" src={brandMark} alt="" sx={{ width: 84, filter: "drop-shadow(0 12px 24px rgba(74,111,224,0.35))" }} />
          <Typography variant="h2" sx={{ fontSize: "1.5rem" }}>Every tick. Every trade. Everywhere.</Typography>
          <Stack spacing={2}>
            {FEATURES.map(([Icon, title, text]) => <Stack key={title} direction="row" spacing={1.5} alignItems="flex-start">
              <Box sx={{ flex: "none", width: 36, height: 36, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "background.paper", color: "primary.main" }}>
                <Icon size={18} />
              </Box>
              <Box>
                <Typography variant="subtitle1" component="p">{title}</Typography>
                <Typography variant="body2" color="text.secondary">{text}</Typography>
              </Box>
            </Stack>)}
          </Stack>
        </Box>
      </Paper>
    </Fade>
  </Box>;
}
