const express = require("express");
const cors = require("cors");
const dataworkspaceRoutes = require("./routes/dataworkspace");

const app = express();
app.use(cors());

app.use(express.json());
app.use("/api/dataworkspace", dataworkspaceRoutes);

const PORT = process.env.SERVER_PORT;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
