import app from "./app";
import { env } from "./config/env";

app.listen(env.PORT, () => {
  console.log(`🚀 Smoke Time Store API listening on http://localhost:${env.PORT}`);
});
