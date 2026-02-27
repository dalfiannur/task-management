import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateClient, useUpdateClient } from "@/hooks/use-clients";
import type { Client } from "@/types/client";
import styles from "./client-form.module.css";

interface ClientFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: Client;
}

export function ClientForm({ open, onOpenChange, client }: ClientFormProps) {
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [attentionName, setAttentionName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const isEdit = !!client;

  useEffect(() => {
    if (client) {
      setName(client.name);
      setLegalName(client.legalName ?? "");
      setStreet(client.street ?? "");
      setCity(client.city ?? "");
      setState(client.state ?? "");
      setPostalCode(client.postalCode ?? "");
      setCountry(client.country ?? "");
      setAttentionName(client.attentionName ?? "");
      setEmail(client.email ?? "");
      setPhoneNumber(client.phoneNumber ?? "");
    } else {
      setName("");
      setLegalName("");
      setStreet("");
      setCity("");
      setState("");
      setPostalCode("");
      setCountry("");
      setAttentionName("");
      setEmail("");
      setPhoneNumber("");
    }
  }, [client, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const fields = {
      name: trimmedName,
      legalName: legalName.trim() || undefined,
      street: street.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      postalCode: postalCode.trim() || undefined,
      country: country.trim() || undefined,
      attentionName: attentionName.trim() || undefined,
      email: email.trim() || undefined,
      phoneNumber: phoneNumber.trim() || undefined,
    };

    if (isEdit) {
      updateClient.mutate(
        { id: client.id, ...fields },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      createClient.mutate(fields, {
        onSuccess: () => onOpenChange(false),
      });
    }
  };

  const isSubmitting = createClient.isLoading || updateClient.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={styles.dialogContent}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Client" : "Create Client"}</DialogTitle>
          </DialogHeader>
          <div className={styles.fieldGroup}>
            <div className={styles.field}>
              <Label htmlFor="client-name">Name</Label>
              <Input
                id="client-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Client name..."
                autoFocus
              />
            </div>
            <div className={styles.field}>
              <Label htmlFor="client-legal-name">Legal Name</Label>
              <Input
                id="client-legal-name"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="Legal name..."
              />
            </div>
            <div className={styles.sectionLabel}>Address</div>
            <div className={styles.field}>
              <Label htmlFor="client-street">Street</Label>
              <Input
                id="client-street"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                placeholder="Street address..."
              />
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <Label htmlFor="client-city">City</Label>
                <Input
                  id="client-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="City..."
                />
              </div>
              <div className={styles.field}>
                <Label htmlFor="client-state">State</Label>
                <Input
                  id="client-state"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="State..."
                />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <Label htmlFor="client-postal-code">Postal Code</Label>
                <Input
                  id="client-postal-code"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder="Postal code..."
                />
              </div>
              <div className={styles.field}>
                <Label htmlFor="client-country">Country</Label>
                <Input
                  id="client-country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="Country..."
                />
              </div>
            </div>
            <div className={styles.sectionLabel}>Contact</div>
            <div className={styles.field}>
              <Label htmlFor="client-attention-name">Attention Name</Label>
              <Input
                id="client-attention-name"
                value={attentionName}
                onChange={(e) => setAttentionName(e.target.value)}
                placeholder="Contact person name..."
              />
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <Label htmlFor="client-email">Email</Label>
                <Input
                  id="client-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address..."
                />
              </div>
              <div className={styles.field}>
                <Label htmlFor="client-phone">Phone Number</Label>
                <Input
                  id="client-phone"
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="Phone number..."
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || isSubmitting}
            >
              {isSubmitting
                ? isEdit
                  ? "Saving..."
                  : "Creating..."
                : isEdit
                  ? "Save"
                  : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
