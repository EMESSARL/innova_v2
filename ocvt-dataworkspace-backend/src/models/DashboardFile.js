const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const DashboardFile = sequelize.define(
  "DashboardFile",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    dashboard_id: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: "FK vers Dashboard",
    },
    file_id: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: "FK vers File",
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "DashboardFile",
    timestamps: false,
    paranoid: true,
    underscored: true,
  }
);

module.exports = DashboardFile;
