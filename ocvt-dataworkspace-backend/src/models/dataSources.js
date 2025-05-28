const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const DataSources = sequelize.define(
  "DataSources",
  {
    source_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.STRING, // Référence à l'utilisateur (fournie par Authentication Microfrontend)
      allowNull: false,
    },
    source_type: {
      type: DataTypes.ENUM("file", "database", "api"), // Type de source
      allowNull: false,
    },
    source_name: {
      type: DataTypes.STRING, // Nom descriptif (texte)
      allowNull: false,
    },
    connection_details: {
      type: DataTypes.JSON, // Détails de connexion (JSON)
      allowNull: true,
    },
    // created_at: {
    //   type: DataTypes.DATE,
    //   allowNull: false,
    //   // defaultValue: Sequelize.NOW,
    // },
    // updated_at: {
    //   type: DataTypes.DATE,
    //   allowNull: false,
    //   // defaultValue: Sequelize.NOW,
    // },
  },
  {
    tableName: "DataSources",
    // timestamps: false, // Géré manuellement via created_at et updated_at
  }
);

module.exports = DataSources;
