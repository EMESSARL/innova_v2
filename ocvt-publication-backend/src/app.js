const express = require("express");
const cors = require("cors");
const publicationRoutes = require("./routes/publications");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/", publicationRoutes);

const PORT = process.env.SERVER_PORT;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
