const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Domain = sequelize.define(
  "Domain",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  },
  {
    tableName: "domains",
    timestamps: false,
  }
);

module.exports = Domain;
