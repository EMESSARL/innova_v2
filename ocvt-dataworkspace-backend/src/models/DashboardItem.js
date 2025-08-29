const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const DashboardItem = sequelize.define(
  "DashboardItem",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    dashboard_id: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: "FK vers Dashboard.id, ON DELETE CASCADE",
    },
    item_type_id: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: "FK vers ItemType.id, ON DELETE RESTRICT",
    },
    config: {
      type: DataTypes.JSONB,
      allowNull: false,
      comment: "Configuration de l'élément (graphique, tableau, etc.)",
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
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
    tableName: "DashboardItem",
    timestamps: false,
    paranoid: true,
    underscored: true,
  }
);

module.exports = DashboardItem;
