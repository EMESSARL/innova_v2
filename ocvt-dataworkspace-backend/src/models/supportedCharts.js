const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const SupportedCharts = sequelize.define(
  "SupportedCharts",
  {
    chart_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    chart_name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    required_parameters: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("active", "inactive"),
      allowNull: false,
      defaultValue: "active",
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "SupportedCharts",
    timestamps: false,
    paranoid: true,
    underscored: true,
  }
);

module.exports = SupportedCharts;
