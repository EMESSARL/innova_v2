const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Domain = require("./domain");

const SubDomain = sequelize.define(
  "SubDomain",
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
    domain_id: {
      type: DataTypes.INTEGER,
      references: {
        model: Domain,
        key: "id",
      },
    },
  },
  {
    tableName: "sub_domains",
    timestamps: false,
  }
);

SubDomain.belongsTo(Domain, { foreignKey: "domain_id" });
Domain.hasMany(SubDomain, { foreignKey: "domain_id" });

module.exports = SubDomain;
