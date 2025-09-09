const express = require("express");
const cors = require("cors");
const dataworkspaceRoutes = require("./routes/dataworkspace");
const dashboardRoutes = require("./routes/dashboards");
const domainRoutes = require("./routes/domains");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/dataworkspace", dataworkspaceRoutes);
app.use("/api/dashboards", dashboardRoutes);
app.use("/api/domains", domainRoutes);

const PORT = process.env.SERVER_PORT;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
