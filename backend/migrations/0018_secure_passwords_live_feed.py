from django.contrib.auth.hashers import make_password
from django.db import migrations, models
import django.utils.timezone


def hash_existing_passwords(apps, schema_editor):
    User = apps.get_model("backend", "User")
    for user in User.objects.using(schema_editor.connection.alias).all().iterator():
        user.password = make_password(user.password)
        user.active_session_token = ""
        user.save(update_fields=["password", "active_session_token"])


class Migration(migrations.Migration):
    dependencies = [("backend", "0017_marketsnapshot_demand_supply_ratio")]
    operations = [
        migrations.AlterField(model_name="user", name="password", field=models.CharField(max_length=128)),
        migrations.RunPython(hash_existing_passwords),
        migrations.CreateModel(
            name="LiveMarketFeed",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("owner", models.CharField(max_length=64, blank=True, default="")),
                ("lease_until", models.FloatField(default=0)),
                ("payload", models.JSONField(default=dict)),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
            ],
        ),
    ]
