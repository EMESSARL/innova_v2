const sequelize = require("../config/db");
const Domain = require("./domain");
const SubDomain = require("./subDomain");
const Publication = require("./publication");

(async () => {
  await sequelize.sync({ alter: true, logging: false });
  // console.log("Modèles synchronisés avec la base de données");
})();

module.exports = {
  sequelize,
  Domain,
  SubDomain,
  Publication,
};
